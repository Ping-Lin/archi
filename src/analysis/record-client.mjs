import {parse} from 'java-parser';
import {hash,identify} from './contract.mjs';

const adapter='spring-record-client/1';
const policy='explicit-record-binding-reviewed';
const known={Configuration:'org.springframework.context.annotation.Configuration',Bean:'org.springframework.context.annotation.Bean',EnableConfigurationProperties:'org.springframework.boot.context.properties.EnableConfigurationProperties',ConfigurationProperties:'org.springframework.boot.context.properties.ConfigurationProperties',RestClient:'org.springframework.web.client.RestClient',WebClient:'org.springframework.web.reactive.function.client.WebClient'};
function nodes(node,name){
  return [...(node?.name===name?[node]:[]),...Object.values(node?.children??{}).flatMap(a=>a.filter(n=>n.children).flatMap(n=>nodes(n,name)))];
}
function tokens(node){
  if(!node)return [];
  if(node.image!==undefined)return [node];
  return Object.values(node.children??{}).flatMap(a=>a.flatMap(tokens)).sort((a,b)=>a.startOffset-b.startOffset);
}
const text=node=>tokens(node).map(t=>t.image).join(' ');
const annotations=(node,modifier)=>(node?.children[modifier]??[]).flatMap(m=>nodes(m,'annotation')).map(text);
const canonical=member=>member.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());

export function extractRecordClients({files,source,env,ledger,service}){
  const records=[],registrations=[],factories=[],diagnostics=[];
  const fail=(file,message)=>diagnostics.push({code:'UNSUPPORTED_RECORD_BINDING',file,message});
  const scope=ledger.recordEvidence({type:'declared_analysis_scope',locator:'source.bindingPolicy',adapter,policy:service?.source.bindingPolicy??null});
  if(service?.source.bindingPolicy!==policy)fail('source','Explicit record binding review is required');
  if(source.files.length>64)throw Error('Record source scope exceeds 64 files');
  for(const file of source.files){
    const content=files.get(file);
    if(typeof content!=='string'||Buffer.byteLength(content)>1024*1024)throw Error('Record source missing or exceeds 1 MiB');
    const evidence=ledger.recordEvidence({type:'code_static_analysis',locator:file,contentHash:hash(content),analyzer:'java-parser@3.0.1',adapter});
    let tree;
    try{tree=parse(content);}catch{fail(file,'Java parse failed');continue;}
    const imports=nodes(tree,'importDeclaration').map(text);
    const imported=name=>imports.includes(`import ${known[name].split('.').join(' . ')} ;`);
    const packageText=text(nodes(tree,'packageDeclaration')[0]);
    const packageName=packageText.replace(/^package /,'').replace(/ ;$/,'').replaceAll(' ','');
    const qualify=name=>{
      if(name.includes('.'))return name;
      const match=imports.map(i=>i.replace(/^import /,'').replace(/ ;$/,'').replaceAll(' ','')).find(i=>i.endsWith('.'+name));
      return match??(packageName?packageName+'.'+name:name);
    };
    const declarations=nodes(tree,'classDeclaration');
    const simpleImports=imports.map(i=>i.split(' . ').at(-1));
    const clean=declarations.length===1&&nodes(tree,'typeDeclaration').length===1&&new Set(simpleImports).size===simpleImports.length&&
      !imports.some(i=>i.includes('*')||i.startsWith('import static '))&&
      !['typeParameters','classExtends','classImplements','interfaceDeclaration','enumDeclaration','annotationInterfaceDeclaration'].some(n=>nodes(tree,n).length);
    if(!clean)fail(file,'One non-generic top-level class/record, explicit imports and no inheritance are required');
    const anns=annotations(declarations[0],'classModifier');
    const record=nodes(tree,'recordDeclaration')[0];
    if(record){
      const prefix=anns.length===1?anns[0].match(/^@ ConfigurationProperties \( (?:(?:prefix|value) = )?"([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*)" \)$/)?.[1]:null;
      const components=nodes(record,'recordComponent').map(text);
      const members=components.map(c=>c.match(/^String ([a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*)$/)?.[1]);
      if(!clean||!imported('ConfigurationProperties')||!prefix||text(record.children.recordBody?.[0])!=='{ }'||members.length===0||members.length>16||members.some(m=>!m)||new Set(members).size!==members.length||imports.some(i=>i.endsWith(' . String ;')&&i!=='import java . lang . String ;')){
        fail(file,'Record requires a canonical literal prefix, 1–16 plain String components and an empty body');continue;
      }
      const name=text(record.children.typeIdentifier?.[0]);
      records.push({name:packageName?packageName+'.'+name:name,prefix,members,file,evidence});
      continue;
    }
    const normal=nodes(tree,'normalClassDeclaration')[0];
    if(!normal){fail(file,'No supported configuration class or properties record');continue;}
    const enable=anns.filter(a=>a.startsWith('@ EnableConfigurationProperties'));
    const config=anns.filter(a=>a==='@ Configuration'||a==='@ Configuration ( proxyBeanMethods = false )');
    if(!clean||!imported('Configuration')||config.length!==1||anns.length!==config.length+enable.length||enable.length>1)fail(file,'Only Configuration and optional explicit EnableConfigurationProperties are supported');
    if(enable.length){
      const match=enable[0].match(/^@ EnableConfigurationProperties \( (?:value = )?(.+) \)$/);
      let list=match?.[1];if(list?.startsWith('{ ')&&list.endsWith(' }'))list=list.slice(2,-2);
      const refs=list?.split(' , ')??[];
      if(!imported('EnableConfigurationProperties')||!refs.length||refs.length>16||refs.some(r=>!/^\w+(?: \. \w+)* \. class$/.test(r)))fail(file,'Explicit properties class literals are required');
      else for(const ref of refs)registrations.push({name:qualify(ref.replace(/ \. class$/,'').replaceAll(' ','')),file,evidence});
    }
    const methods=nodes(normal,'methodDeclaration');
    if(text(normal.children.classBody?.[0])!==`{ ${methods.map(text).join(' ')} }`.replace('{  }','{ }'))fail(file,'Configuration body must contain only supported factory methods');
    for(const method of methods){
      const header=method.children.methodHeader?.[0],decl=nodes(header,'methodDeclarator')[0];
      const name=decl?.children.Identifier?.[0]?.image??'unknown';
      const result=text(header?.children.result?.[0]);
      const param=text(decl).match(/^\w+ \( ([A-Za-z][\w]*(?: \. [A-Za-z][\w]*)*) ([a-z][A-Za-z0-9]*) \)$/);
      const body=text(method.children.methodBody?.[0]);
      const member=param?body.match(new RegExp('\\b'+param[2]+' \\. ([a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*) \\( \\)'))?.[1]:null;
      const access=param&&member?`${param[2]} . ${member} ( )`:'';
      const valid=annotations(method,'methodModifier').join(' ')==='@ Bean'&&imported('Bean')&&['RestClient','WebClient'].includes(result)&&imported(result)&&param&&param[2]!==result&&member&&
        [`{ return ${result} . create ( ${access} ) ; }`,`{ return ${result} . builder ( ) . baseUrl ( ${access} ) . build ( ) ; }`].includes(body);
      if(!valid)fail(file,'Factory requires one record parameter and a direct String accessor in a supported HTTP factory');
      factories.push({file,name,line:method.location.startLine,evidence,type:param?qualify(param[1].replaceAll(' ','')):null,member:member??null});
    }
  }
  for(const r of records)if(records.filter(x=>x.name===r.name).length!==1||registrations.filter(x=>x.name===r.name).length!==1)fail(r.file,'Record type must have exactly one declaration and registration');
  for(const r of registrations)if(records.filter(x=>x.name===r.name).length!==1)fail(r.file,'Registered record is missing or ambiguous');
  for(const f of factories)if(records.filter(r=>r.name===f.type&&r.members.includes(f.member)).length!==1)fail(f.file,'Factory record/accessor cannot be bound uniquely');
  const invalid=diagnostics.length>0;
  const candidates=factories.map(f=>{
    const record=records.find(r=>r.name===f.type),matches=registrations.filter(r=>r.name===f.type);
    const key=record&&f.member?record.prefix+'.'+canonical(f.member):null;
    const bindingKeys=record?.members.map(m=>record.prefix+'.'+canonical(m))??[];
    const unsupported=invalid?['Selected record source scope is incomplete or unsupported']:[];
    const id=identify('candidate',{environment:env.id,source:source.service,adapter,file:f.file,name:f.name,line:f.line});
    const evidenceIds=[...new Set([scope,f.evidence,...(record?[record.evidence]:[]),...matches.map(r=>r.evidence)])];
    const registrationFact=ledger.fact('configuration.binding',id,{adapter,type:f.type,member:f.member,key,bindingKeys,registrations:matches.map(r=>r.file),policy},evidenceIds);
    const factId=ledger.fact('client.candidate',id,{name:f.name,key,registrationFact,endpointMeaning:'configured-base-url',sourceAdapter:adapter,unsupported},evidenceIds);
    return {id,name:f.name,source:source.service,file:f.file,line:f.line,key,bindingKeys,conditions:[],unsupported,factId,registrationFact,endpointMeaning:'configured-base-url',sourceAdapter:adapter};
  });
  return {candidates,diagnostics,coverage:{collector:'spring-record-client',status:invalid?'partial':'complete',meaning:'Explicit String record accessor to configured HTTP base URL; reviewed activation/conversion scope; no general binding or request analysis'}};
}
