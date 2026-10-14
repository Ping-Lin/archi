import {parseAllDocuments} from 'yaml';
import {parseProperties,flattenProperties} from './property-files.mjs';

// Bounded Spring profile expressions; mixed &/| require explicit parentheses.
export function matchesProfile(expression,profiles){
  if(typeof expression!=='string'||!expression.trim()||expression.length>256)throw Error('Invalid profile expression');
  const tokens=expression.match(/[A-Za-z0-9_][A-Za-z0-9_-]*|[!&|()]/g)??[];
  if(tokens.length>64||tokens.join('')!==expression.replace(/\s/g,''))throw Error('Unsupported profile expression');
  let index=0;
  const atom=depth=>{
    if(depth>16)throw Error('Profile expression depth exceeded');
    const token=tokens[index++];
    if(token==='!')return !atom(depth+1);
    if(token==='('){const value=group(depth+1);if(tokens[index++]!==')')throw Error('Unclosed profile expression');return value;}
    if(!token||!/^\w[\w-]*$/.test(token))throw Error('Expected profile name');
    return profiles.includes(token);
  };
  const group=depth=>{
    let value=atom(depth),operator=null;
    while(index<tokens.length&&tokens[index]!==')'){
      const next=tokens[index++];
      if(!['&','|'].includes(next)||(operator&&operator!==next))throw Error('Ambiguous profile expression');
      operator=next;const right=atom(depth);value=next==='&'?value&&right:value||right;
    }
    return value;
  };
  const result=group(0);if(index!==tokens.length)throw Error('Unexpected profile expression token');return result;
}

export function parseConfigDocuments(file,text,profiles){
  if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024)throw Error('Config document input unavailable or too large');
  let mappings;
  if(file.endsWith('.properties')){
    const lines=text.split(/\r\n|\n|\r/),parts=[''];
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(/^[#!]---$/.test(line)){
        if((lines[i-1]?.match(/\\+$/)?.[0].length??0)%2)throw Error('Document separator after a continuation is unsupported');
        if([lines[i-1],lines[i+1]].some(s=>s?.startsWith(line[0])))throw Error('Ambiguous properties document separator');
        parts.push('');if(parts.length>32)throw Error('Too many config documents');
      }else parts[parts.length-1]+=line+'\n';
    }
    mappings=parts.map(parseProperties);
  }else if(/\.ya?ml$/.test(file)){
    const docs=parseAllDocuments(text,{uniqueKeys:true});
    if(docs.length>32)throw Error('Too many config documents');
    mappings=docs.map(doc=>{
      if(doc.errors.length)throw Error(doc.errors[0].message);
      const value=doc.toJS({maxAliasCount:100});return value===null?Object.create(null):flattenProperties(value);
    });
  }else throw Error('Expected properties or YAML config documents');
  return mappings.map((mapping,index)=>{
    for(const key of Object.keys(mapping))if(key==='spring.profiles'||key.startsWith('spring.profiles.')||(key.startsWith('spring.config.activate.')&&key!=='spring.config.activate.on-profile'))throw Error('Unsupported profile bootstrap or activation rule');
    const expression=mapping['spring.config.activate.on-profile'];
    const active=expression===undefined||matchesProfile(expression,profiles);
    delete mapping['spring.config.activate.on-profile'];
    return {index,mapping,expression:expression??null,active};
  });
}
