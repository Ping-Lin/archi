// Exact-key, closed-scope placeholder evaluation. No process.env, I/O, expressions
// or Spring relaxed-name guessing. Limits bound cycles and expansion attacks.
export const PLACEHOLDER_LIMITS = Object.freeze({keys:2048,depth:32,value:65536,total:2097152,steps:50000});
export function resolvePlaceholders(raw, blockedDefaults = []) {
  const limits=PLACEHOLDER_LIMITS, cache=new Map(), active=new Set(), errors=[];
  const values=Object.create(null), traces=Object.create(null), keys=Object.keys(raw);
  let steps=0,total=0;
  const fail=message=>{throw Error(message);};
  const tick=()=>{if(++steps>limits.steps)fail('Placeholder work limit exceeded');};
  const size=value=>{if(value.length>limits.value)fail('Placeholder value limit exceeded');return value;};
  const aliases=new Map();
  const normalized=key=>key.toLowerCase().replace(/[._-]/g,'');
  for(const key of keys){const n=normalized(key);if(!aliases.has(n))aliases.set(n,[]);aliases.get(n).push(key);}
  if(keys.length>limits.keys)return {values,traces,errors:[{key:null,message:'Placeholder property count limit exceeded'}]};

  function parse(text,depth=0) {
    size(text);if(depth>limits.depth)fail('Placeholder nesting limit exceeded');
    const nodes=[];let offset=0;
    while(offset<text.length) {
      tick();const start=text.indexOf('${',offset);
      if(start<0){nodes.push(text.slice(offset));break;}
      if(start>0&&text[start-1]==='\\')fail('Escaped placeholders are unsupported');
      nodes.push(text.slice(offset,start));
      let end=start+2,nesting=1;
      for(;end<text.length;end++) {
        tick();if(text.startsWith('${',end)){nesting++;end++;}
        else if(text[end]==='}'&&--nesting===0)break;
        if(nesting>limits.depth)fail('Placeholder nesting limit exceeded');
      }
      if(nesting)fail('Unclosed placeholder');
      const body=text.slice(start+2,end),colon=body.indexOf(':');
      const key=colon<0?body:body.slice(0,colon);
      if(!/^[A-Za-z0-9_.-]+$/.test(key))fail('Dynamic or unsupported placeholder key');
      if(key.startsWith('random.')||key.startsWith('spring.'))fail('Framework placeholder source is unsupported');
      const fallback=colon<0?null:parse(body.slice(colon+1),depth+1);
      nodes.push({key,fallback});offset=end+1;
    }
    if((depth>0||text.includes('${'))&&nodes.some(n=>typeof n==='string'&&/[{}]/.test(n)))
      fail('Literal braces within placeholder expressions are unsupported');
    return nodes;
  }

  function resolve(key,depth=0) {
    tick();if(cache.has(key))return cache.get(key);
    if(depth>limits.depth)fail('Placeholder dependency depth exceeded');
    if(active.has(key))fail('Circular placeholder reference');
    active.add(key);
    try {
      const refs=new Set(),defaults=new Set();let height=0;
      const evaluate=nodes=>{
        let output='';
        for(const node of nodes){
          tick();if(typeof node==='string'){output=size(output+node);continue;}
          const alternatives=aliases.get(normalized(node.key))??[];
          if(alternatives.some(k=>k!==node.key))fail('Relaxed-name alias requires an explicit supported binding');
          if(Object.hasOwn(raw,node.key)) {
            const dependency=resolve(node.key,depth+1);
            height=Math.max(height,dependency.depth+1);
            if(height>limits.depth)fail('Placeholder dependency depth exceeded');
            refs.add(node.key);dependency.references.forEach(r=>{tick();refs.add(r);});
            dependency.defaults.forEach(r=>{tick();defaults.add(r);});
            output=size(output+dependency.value);
          }else if(blockedDefaults.includes(node.key))fail('Environment name is mapped to another key; an explicit placeholder binding is required');
          else if(node.fallback!==null){defaults.add(node.key);output=size(output+evaluate(node.fallback));}
          else fail('Referenced property is absent from the reviewed scope');
        }
        return output;
      };
      if(typeof raw[key]!=='string')fail('Placeholder input must be a string');
      const value=evaluate(parse(raw[key]));
      if(value.includes('${')||value.includes('#{')||value.includes('$('))fail('Unsupported expression remains after placeholder evaluation');
      total+=value.length;if(total>limits.total)fail('Placeholder output limit exceeded');
      const result={value,references:[...refs].sort(),defaults:[...defaults].sort(),depth:height};cache.set(key,result);return result;
    }finally{active.delete(key);}
  }
  for(const key of keys) {
    try{const result=resolve(key);values[key]=result.value;traces[key]=result;}
    catch(error){errors.push({key,message:error.message});}
  }
  return {values,traces,errors};
}

export function applyPlaceholders(values,chains,ledger,policyEvidence,blockedDefaults=[]) {
  const result=resolvePlaceholders(values,blockedDefaults), originalChains=structuredClone(chains);
  for(const [key,trace] of Object.entries(result.traces)) {
    if(!values[key].includes('${'))continue;
    const inputFactIds=[...new Set([key,...trace.references].flatMap(k=>originalChains[k]??[]))];
    const evidenceIds=[...new Set([policyEvidence,...ledger.facts.filter(f=>inputFactIds.includes(f.id)).flatMap(f=>f.evidenceIds)])];
    const fact=ledger.fact('property.placeholder',key,{
      value:trace.value,references:trace.references,defaultsUsed:trace.defaults,inputFactIds,
      rule:'closed-scope-placeholders/1',
    },evidenceIds);
    chains[key]=[...inputFactIds,fact];values[key]=trace.value;
  }
  return result.errors.map(error=>({code:'PLACEHOLDER_UNRESOLVED',message:`${error.key??'Property scope'}: ${error.message}`}));
}
