import {parse} from 'java-parser';
import {hash,identify} from './contract.mjs';

const adapter='spring-feign/1';
const policy='explicit-registration-and-defaults-reviewed';
const known={Configuration:'org.springframework.context.annotation.Configuration',EnableFeignClients:'org.springframework.cloud.openfeign.EnableFeignClients',FeignClient:'org.springframework.cloud.openfeign.FeignClient'};
function nodes(node,name){
  return [...(node?.name===name?[node]:[]),...Object.values(node?.children??{}).flatMap(a=>a.filter(n=>n.children).flatMap(n=>nodes(n,name)))];
}
function tokens(node){
  if(!node)return [];
  if(node.image!==undefined)return [node];
  return Object.values(node.children??{}).flatMap(a=>a.flatMap(tokens)).sort((a,b)=>a.startOffset-b.startOffset);
}
const text=node=>tokens(node).map(t=>t.image).join(' ');
const annotations=(node,modifier)=> (node?.children[modifier]??[]).flatMap(m=>nodes(m,'annotation'));
const annotationName=node=>text(node.children.typeName?.[0]);
const className=node=>text(node?.children.typeIdentifier?.[0]);

// Only explicit class literals bind registration to interfaces. No scanning or loading.
export function extractFeign({files,source,env,ledger,service}){
  const clients=[],registrations=[],diagnostics=[];
  const fail=(file,message)=>diagnostics.push({code:'UNSUPPORTED_FEIGN_SCOPE',file,message});
  const scopeEvidence=ledger.recordEvidence({type:'declared_analysis_scope',locator:'source.registrationPolicy',adapter,policy:service?.source.registrationPolicy??null});
  if(service?.source.registrationPolicy!==policy)fail('source','Explicit registration/defaults review is required');
  if(source.files.length>64)throw Error('Feign scope exceeds 64 files');
  for(const file of source.files){
    const content=files.get(file);
    if(typeof content!=='string'||Buffer.byteLength(content)>1024*1024)throw Error('Feign input missing or exceeds 1 MiB');
    const evidenceId=ledger.recordEvidence({type:'code_static_analysis',locator:file,contentHash:hash(content),analyzer:'java-parser@3.0.1',adapter});
    let tree;
    try{tree=parse(content);}catch{fail(file,'Java parse failed');continue;}
    const imports=nodes(tree,'importDeclaration').map(text);
    const simpleImports=imports.map(i=>i.split(' . ').at(-1));
    const imported=name=>imports.includes(`import ${known[name].split('.').join(' . ')} ;`);
    const packageText=text(nodes(tree,'packageDeclaration')[0]);
    const packageName=packageText?packageText.replace(/^package /,'').replace(/ ;$/,'').replaceAll(' ',''):'';
    const qualify=name=>packageName?`${packageName}.${name}`:name;
    const classes=nodes(tree,'normalClassDeclaration'),interfaces=nodes(tree,'normalInterfaceDeclaration');
    const clean=classes.length+interfaces.length===1 && nodes(tree,'typeDeclaration').length===1 &&
      new Set(simpleImports).size===simpleImports.length &&
      !imports.some(i=>i.includes('*')||i.startsWith('import static ')) &&
      !['typeParameters','classExtends','classImplements','interfaceExtends','enumDeclaration','recordDeclaration','annotationInterfaceDeclaration'].some(n=>nodes(tree,n).length);
    if(!clean)fail(file,'One non-generic top-level class/interface, explicit imports and no inheritance are required');
    if(classes.length===1){
      const declaration=nodes(tree,'classDeclaration')[0],normal=classes[0];
      const anns=annotations(declaration,'classModifier');
      const enable=anns.filter(a=>annotationName(a)==='EnableFeignClients');
      const match=enable.length===1?text(enable[0]).match(/^@ EnableFeignClients \( clients = (.+) \)$/):null;
      let listed=match?.[1];
      if(listed?.startsWith('{ ')&&listed.endsWith(' }'))listed=listed.slice(2,-2);
      const refs=listed?.split(' , ')??[];
      const valid=clean&&imported('Configuration')&&imported('EnableFeignClients')&&anns.length===2&&
        anns.some(a=>text(a)==='@ Configuration')&&text(normal.children.classBody?.[0])==='{ }'&&
        refs.length>0&&refs.length<=64&&refs.every(r=>/^[A-Za-z_$][\w$]*(?: \. [A-Za-z_$][\w$]*)* \. class$/.test(r));
      if(!valid){fail(file,'Registration requires an empty Configuration class and an explicit clients-only EnableFeignClients annotation');continue;}
      for(const ref of refs){
        const name=ref.replace(/ \. class$/,'').replaceAll(' ','');
        const importedNames=imports.map(i=>i.replace(/^import /,'').replace(/ ;$/,'').replaceAll(' ','')).filter(i=>i.endsWith('.'+name));
        if(importedNames.length>1){fail(file,'Ambiguous client class import');continue;}
        registrations.push({name:name.includes('.')?name:importedNames[0]??qualify(name),file,evidenceId});
      }
    }else if(interfaces.length===1){
      const declaration=nodes(tree,'interfaceDeclaration')[0],normal=interfaces[0];
      const anns=annotations(declaration,'interfaceModifier');
      const feign=anns.filter(a=>annotationName(a)==='FeignClient');
      const fields={};let valid=clean&&imported('FeignClient')&&anns.length===1&&feign.length===1;
      for(const pair of nodes(feign[0],'elementValuePair')){
        const key=pair.children.Identifier?.[0]?.image,value=text(pair.children.elementValue?.[0]);
        if(Object.hasOwn(fields,key)||!['name','value','url'].includes(key)||!/^"[^"\\]*"$/.test(value))valid=false;
        fields[key]=value.slice(1,-1);
      }
      const clientName=fields.name??fields.value;
      const key=fields.url?.match(/^\$\{([A-Za-z0-9_.-]+)\}$/)?.[1]??null;
      valid=valid&&Object.keys(fields).length===2&&!(fields.name&&fields.value)&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(clientName??'')&&key!==null;
      const name=qualify(className(normal));
      clients.push({name,clientName:clientName??null,key,file,line:declaration.location.startLine,evidenceId,valid});
      if(!valid)fail(file,'FeignClient requires only a literal name/value and exact URL property placeholder');
    }else fail(file,'No supported Feign interface or explicit registration class');
  }
  for(const r of registrations)if(clients.filter(c=>c.name===r.name).length!==1)fail(r.file,`Registered interface is missing or ambiguous: ${r.name}`);
  for(const c of clients){
    if(registrations.filter(r=>r.name===c.name).length!==1)fail(c.file,'Missing or duplicate explicit registration');
    if(clients.filter(other=>other.name===c.name||other.clientName===c.clientName).length!==1)fail(c.file,'Duplicate interface or Feign client name');
  }
  const invalidScope=diagnostics.length>0;
  const candidates=clients.map(c=>{
    const matches=registrations.filter(r=>r.name===c.name),unsupported=[];
    if(invalidScope)unsupported.push('Selected Feign source scope contains unsupported or invalid inputs');
    if(matches.length!==1)unsupported.push('Exactly one explicit registration of this fully qualified interface is required');
    if(clients.filter(other=>other.name===c.name||other.clientName===c.clientName).length!==1)unsupported.push('Duplicate interface or Feign client name');
    const id=identify('candidate',{environment:env.id,source:source.service,adapter,file:c.file,name:c.name});
    const registrationFact=ledger.fact('client.registration',id,{adapter,interface:c.name,registrations:matches.map(r=>({file:r.file,name:r.name})),policy},[scopeEvidence,c.evidenceId,...matches.map(r=>r.evidenceId)]);
    const factId=ledger.fact('client.candidate',id,{name:c.name,key:c.key,clientName:c.clientName,registrationFact,endpointMeaning:'configured-base-url',sourceAdapter:adapter,unsupported},[scopeEvidence,c.evidenceId,...matches.map(r=>r.evidenceId)]);
    if(unsupported.length)fail(c.file,unsupported.join('; '));
    return {id,name:c.name,source:source.service,file:c.file,line:c.line,key:c.key,conditions:[],unsupported,factId,registrationFact,endpointMeaning:'configured-base-url',sourceAdapter:adapter};
  });
  return {candidates,diagnostics,coverage:{collector:'spring-feign',status:diagnostics.length?'partial':'complete',meaning:'Configured annotation base URLs in listed inputs, conditional on reviewed configuration activation/defaults; no request or whole-program analysis'}};
}
