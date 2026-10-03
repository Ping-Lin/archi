import {parsePropertyFile} from './property-files.mjs';
export const absoluteConfigPath=p=>typeof p==='string'&&/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(p)&&!p.split('/').some(s=>s==='.'||s==='..');
const relative=p=>typeof p==='string'&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)&&!p.split('/').some(s=>s==='.'||s==='..');
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const mode=v=>v===undefined||(Number.isInteger(v)&&v>=0&&v<=511);
const name=v=>typeof v==='string'&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(v)&&v.length<=253;
export function resolveMountedConfig(container,deployment,resources,env,variables,ledger){
  const diagnostics=[],sources=[],factIds=[],projected=new Map(),mountPaths=[];
  const fail=message=>diagnostics.push({code:'MOUNTED_CONFIG_INCOMPLETE',message});
  const mounts=container?.volumeMounts??[],volumes=deployment?.spec?.template?.spec?.volumes??[];
  if(!Array.isArray(mounts)||!Array.isArray(volumes)||mounts.length>64||volumes.length>128)return {sources,factIds,complete:false,diagnostics:[{code:'MOUNTED_CONFIG_INCOMPLETE',message:'Invalid or excessive volume inputs'}]};
  for(const mount of mounts){
    if(!fields(mount,['name','mountPath','subPath','readOnly'])||!name(mount.name)||!absoluteConfigPath(mount.mountPath)||(mount.subPath!==undefined&&!relative(mount.subPath))||(mount.readOnly!==undefined&&typeof mount.readOnly!=='boolean')){fail('Unsupported mount shape or path');continue;}
    if(mountPaths.some(p=>p===mount.mountPath||p.startsWith(mount.mountPath+'/')||mount.mountPath.startsWith(p+'/')))fail('Overlapping mount paths');
    mountPaths.push(mount.mountPath);
    const candidates=volumes.filter(v=>v?.name===mount.name),volume=candidates.length===1?candidates[0]:null;
    if(!fields(volume,['name','configMap'])||!fields(volume.configMap,['name','items','optional','defaultMode'])){fail(`Mount ${mount.name} requires a unique ConfigMap volume; Secret/projected/other volumes stay unknown`);continue;}
    const cm=volume.configMap;
    if(!name(cm.name)||!mode(cm.defaultMode)||(cm.optional!==undefined&&typeof cm.optional!=='boolean')){fail('Invalid ConfigMap volume selector');continue;}
    const key=[env.cluster,'','configmaps',env.namespace,cm.name].join('|');
    const matches=resources.filter(r=>r.kind==='ConfigMap'&&r.key===key),resource=matches.length===1?matches[0]:null;
    const evidenceIds=[deployment?.evidenceId,resource?.evidenceId].filter(Boolean);
    const record=(file,dataKey,status)=>{const id=ledger.fact('configuration.mount',`${deployment.key}/${mount.name}/${file}`,{volume:mount.name,resourceKey:key,key:dataKey,path:file,status,subPath:mount.subPath??null},evidenceIds);factIds.push(id);return id;};
    if(!resource){record(mount.mountPath,null,'unavailable');fail(`ConfigMap ${cm.name} unavailable; optional does not prove runtime absence`);continue;}
    if(resource.hasBinaryData){fail(`Binary ConfigMap projection unsupported: ${cm.name}`);continue;}
    const data=resource.data;
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.values(data).some(v=>typeof v!=='string')){fail(`Invalid ConfigMap data: ${cm.name}`);continue;}
    const items=cm.items??Object.keys(data).map(key=>({key,path:key}));
    if(!Array.isArray(items)||items.length>2048){fail('Invalid or excessive ConfigMap items');continue;}
    const paths=new Set();let selected=0;
    for(const item of items){
      if(!fields(item,['key','path','mode'])||typeof item.key!=='string'||!/^[A-Za-z0-9_.-]+$/.test(item.key)||!mode(item.mode)||!relative(item.path)||paths.has(item.path)){fail('Invalid or duplicate ConfigMap item path');continue;}
      if([...paths].some(p=>p.startsWith(item.path+'/')||item.path.startsWith(p+'/')))fail('Overlapping ConfigMap item paths');
      paths.add(item.path);
      if(!Object.hasOwn(data,item.key)){fail(`Missing ConfigMap key ${cm.name}/${item.key}`);continue;}
      if(mount.subPath!==undefined&&item.path!==mount.subPath)continue;
      selected++;
      const file=mount.subPath!==undefined?mount.mountPath:mount.mountPath+'/'+item.path;
      const id=record(file,item.key,'projected');
      if(projected.has(file))fail(`Ambiguous projected file: ${file}`);
      projected.set(file,{text:data[item.key],evidenceIds,factId:id});
    }
    if(mount.subPath!==undefined&&selected!==1)fail(`subPath must select exactly one captured file: ${mount.name}`);
  }
  const paths=env.mountedFiles??[];
  if(!Array.isArray(paths)||paths.length>64||new Set(paths).size!==paths.length||paths.some(p=>!absoluteConfigPath(p)||!/\.(properties|ya?ml)$/.test(p)))return {sources,factIds,complete:false,diagnostics:[...diagnostics,{code:'MOUNTED_CONFIG_INCOMPLETE',message:'Invalid mountedFiles declaration'}]};
  const locations=variables.filter(v=>v.name==='SPRING_CONFIG_ADDITIONAL_LOCATION');
  const expected=paths.map(p=>'file:'+p).join(',');
  if(!paths.length||locations.length!==1||locations[0].value!==expected)fail('SPRING_CONFIG_ADDITIONAL_LOCATION must exactly match ordered mountedFiles as file: paths');
  for(const file of paths){
    for(const profile of env.profiles?.length?env.profiles:['default']){
      const variant=file.replace(/(\.[^.]+)$/,`-${profile}$1`);
      if(projected.has(variant))fail(`Automatic profile variant is outside reviewed explicit ordering: ${variant}`);
    }
    const captured=projected.get(file);
    if(!captured){fail(`Declared mounted file unavailable: ${file}`);continue;}
    try{sources.push({file:`mounted:${file}`,mapping:parsePropertyFile(file,captured.text),evidenceIds:captured.evidenceIds});}
    catch{fail(`Mounted property file has unsupported syntax: ${file}`);}
  }
  for(const file of projected.keys())if(!paths.includes(file))fail(`Unreviewed mounted file: ${file}`);
  return {sources,factIds,diagnostics,complete:diagnostics.length===0};
}
