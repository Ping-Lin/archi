import { projectGraph } from './model.mjs';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
const json = x => JSON.stringify(x,null,2)+'\n';
// JSON-quoted scalars are valid YAML 1.2, avoiding implicit booleans/numbers.
export function yaml(value, depth=0) {
  const pad='  '.repeat(depth);
  if (Array.isArray(value) && value.length) return value.map(v=>typeof v === 'object' && v !== null ? `${pad}-\n${yaml(v,depth+1)}` : `${pad}- ${JSON.stringify(v)}\n`).join('');
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length) return Object.entries(value).map(([k,v])=>`${pad}${JSON.stringify(k)}:${v && typeof v === 'object' && Object.keys(v).length ? '\n'+yaml(v,depth+1) : ' '+JSON.stringify(v)+'\n'}`).join('');
  return pad+JSON.stringify(value)+'\n';
}
export function generate(config,snapshot) {
  const graph=projectGraph(config,snapshot), files={'web/data.json':json(graph)};
  const services=new Map(config.services.map(s=>[s.id,s]));
  const compose={services:{}};
  for (const s of config.services) {
    const dependencies=config.dependencies.filter(e=>e.source===s.id);
    files[`examples/projects/${s.project}/services/${s.id}/service.json`]=json({...s,dependencies,simulation:true});
    compose.services[s.id]={build:{context:'.',dockerfile:'src/mock/Dockerfile'},environment:{SERVICE_ID:s.id,PORT:'8080',DEPENDENCIES:JSON.stringify(Object.fromEntries(dependencies.map(e=>[e.target,`http://${e.target}:8080`])))},ports:[`127.0.0.1:${s.port}:8080`],read_only:true,tmpfs:['/tmp'],cap_drop:['ALL'],security_opt:['no-new-privileges:true']};
  }
  files['compose.yaml']=yaml(compose);
  for (const p of config.projects) files[`examples/projects/${p.id}/project.json`]=json({...p,simulation:true,services:config.services.filter(s=>s.project===p.id).map(s=>s.id)});
  for (const c of config.contexts) for (const p of config.projects) {
    const rows=config.deployments.filter(d=>d.context===c.id && services.get(d.service).project===p.id).map(d=>({id:d.service,replicas:d.replicas,image:d.image,sourceCommit:d.sourceCommit??'',dependencies:Object.fromEntries(config.dependencies.filter(e=>e.source===d.service).map(e=>[e.target,`http://${e.target}.${c.namespace}.svc.cluster.local:8080`]))}));
    files[`generated/helm/${c.id}/${p.id}.yaml`]=yaml({project:p.id,context:c.id,services:rows});
  }
  return files;
}
const owned = name => /^(web\/data\.json|compose\.yaml|examples\/projects\/[a-z0-9-]+\/(project\.json|services\/[a-z0-9-]+\/service\.json)|generated\/helm\/[a-z0-9-]+\/[a-z0-9-]+\.yaml)$/.test(name);
export async function writeGenerated(root,files,check=false) {
  const manifest=path.join(root,'generated/manifest.json');
  let previous=[];
  try {previous=JSON.parse(await readFile(manifest,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
  if (!Array.isArray(previous) || !previous.every(owned) || !Object.keys(files).every(owned)) throw new Error('Invalid generated ownership manifest');
  const changes=[];
  for (const [name,content] of Object.entries({...files,'generated/manifest.json':json(Object.keys(files).sort())})) {
    const target=path.join(root,name);
    let current; try {current=await readFile(target,'utf8');} catch(e) {if(e.code!=='ENOENT') throw e;}
    if (current!==content) {changes.push(name);if(!check){await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);}}
  }
  for (const name of previous.filter(n=>!Object.hasOwn(files,n))) {changes.push(name);if(!check)await unlink(path.join(root,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  return changes;
}
