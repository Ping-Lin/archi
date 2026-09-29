// Resolve captured render inputs only. Missing resources never prove cluster absence.
export function resolveConfigMapEnvironment(container, deployment, resources, env, ledger) {
  const variables=new Map(), diagnostics=[], factIds=[];
  const fail=(code,message)=>diagnostics.push({code,message});
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const fields=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
  const envName=n=>typeof n==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(n);
  const reference=(kind,ref,locator,key=null)=>{
    const valid=fields(ref,key===null?['name','optional']:['name','key','optional'])&&
      typeof ref.name==='string'&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(ref.name)&&
      (ref.optional===undefined||typeof ref.optional==='boolean')&&
      (key===null||(typeof key==='string'&&/^[A-Za-z0-9._-]+$/.test(key)));
    if(!valid){fail('CONFIG_REFERENCE_INVALID',`Invalid ${kind} reference at ${locator}`);return null;}
    const resourceKey=[env.cluster,'',kind==='ConfigMap'?'configmaps':'secrets',env.namespace,ref.name].join('|');
    const matches=kind==='ConfigMap'?resources.filter(r=>r.kind===kind&&r.key===resourceKey):[];
    const resource=matches.length===1?matches[0]:null;
    const data=resource?.data;
    let status=kind==='Secret'?'opaque':matches.length>1?'ambiguous':!resource?'unavailable':
      !object(data)||Object.values(data).some(v=>typeof v!=='string')?'invalid':
      key!==null&&!Object.hasOwn(data,key)?'key-unavailable':'resolved';
    const evidenceIds=[...new Set([deployment?.evidenceId,resource?.evidenceId].filter(Boolean))];
    const factId=ledger.fact('configuration.reference',locator,{kind,name:ref.name,key,resourceKey,optional:ref.optional??false,status},evidenceIds);
    factIds.push(factId);
    if(status!=='resolved'){
      fail(kind==='Secret'?'SECRET_VALUE_UNAVAILABLE':'CONFIGMAP_REFERENCE_UNRESOLVED',`${kind} ${ref.name}${key===null?'':`/${key}`}: ${status}; optional does not prove absence in a captured render`);
      return null;
    }
    return {data,evidenceIds,factId,resourceKey};
  };
  const envFrom=container?.envFrom??[],explicit=container?.env??[];
  if(!Array.isArray(envFrom)||!Array.isArray(explicit)||envFrom.length>128||explicit.length>2048){
    fail('CONFIG_ENV_INVALID','Environment source shape or count exceeds supported bounds');
    return {variables:[],diagnostics,factIds,complete:false};
  }
  for(const [index,entry] of envFrom.entries()) {
    const locator=`${deployment.key}/envFrom/${index}`;
    if(!fields(entry,['prefix','configMapRef','secretRef'])||Number(!!entry.configMapRef)+Number(!!entry.secretRef)!==1||
      (entry.prefix!==undefined&&(typeof entry.prefix!=='string'||(entry.prefix!==''&&!envName(entry.prefix))))){
      fail('CONFIG_REFERENCE_INVALID',`Unsupported envFrom at ${locator}`);continue;
    }
    const ref=reference(entry.secretRef?'Secret':'ConfigMap',entry.secretRef??entry.configMapRef,locator);
    if(!ref)continue;
    if(Object.keys(ref.data).length>2048){fail('CONFIG_ENV_INVALID','ConfigMap environment exceeds 2048 keys');continue;}
    for(const [key,value] of Object.entries(ref.data)) {
      const name=(entry.prefix??'')+key;
      if(!envName(name)){fail('CONFIG_ENV_INVALID',`Unsupported environment name from ${ref.resourceKey}`);continue;}
      variables.set(name,{name,value,_evidenceIds:ref.evidenceIds,_referenceFactIds:[ref.factId],_locator:`${ref.resourceKey}/data/${key}`});
    }
  }
  const seen=new Set();
  for(const [index,entry] of explicit.entries()) {
    const locator=`${deployment.key}/env/${index}`;
    if(!fields(entry,['name','value','valueFrom'])||!envName(entry.name)||seen.has(entry.name)){
      fail('CONFIG_ENV_INVALID',`Invalid or duplicate explicit environment entry at ${locator}`);continue;
    }
    seen.add(entry.name);
    if(Object.hasOwn(entry,'valueFrom')){
      const from=entry.valueFrom;
      if(Object.hasOwn(entry,'value')||!fields(from,['configMapKeyRef','secretKeyRef'])||Number(!!from.configMapKeyRef)+Number(!!from.secretKeyRef)!==1){
        fail('CONFIG_REFERENCE_INVALID',`Unsupported valueFrom at ${locator}`);continue;
      }
      const selector=from.secretKeyRef??from.configMapKeyRef;
      if(typeof selector?.key!=='string'){fail('CONFIG_REFERENCE_INVALID',`Missing reference key at ${locator}`);continue;}
      const ref=reference(from.secretKeyRef?'Secret':'ConfigMap',selector,locator,selector?.key??undefined);
      if(ref)variables.set(entry.name,{name:entry.name,value:ref.data[selector.key],_evidenceIds:ref.evidenceIds,_referenceFactIds:[ref.factId],_locator:`${ref.resourceKey}/data/${selector.key}`});
    }else if(typeof entry.value==='string')variables.set(entry.name,{...entry,_evidenceIds:[deployment.evidenceId].filter(Boolean)});
    else fail('CONFIG_ENV_INVALID',`Explicit environment value missing at ${locator}`);
  }
  if(variables.size>2048)fail('CONFIG_ENV_INVALID','Effective environment exceeds 2048 keys');
  return {variables:[...variables.values()],diagnostics,factIds,complete:diagnostics.length===0};
}
