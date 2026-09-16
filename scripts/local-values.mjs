import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {generate,yaml} from '../src/core/generate.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const config=JSON.parse(await readFile(path.join(root,'config/system.json'),'utf8'));
const snapshot=JSON.parse(await readFile(path.join(root,'config/observations.json'),'utf8'));
// Validate normal inputs before generating an isolated local override.
generate(config,snapshot);
const context=config.contexts.find(c=>c.environment==='dev');
if(!context)throw new Error('No development context declared');
await mkdir(path.join(root,'artifacts/local-helm'),{recursive:true});
for(const project of config.projects){
 const services=config.deployments.filter(d=>d.context===context.id&&config.services.find(s=>s.id===d.service).project===project.id).map(d=>({id:d.service,replicas:1,image:{repository:'archi-mock',tag:'dev'},sourceCommit:'',dependencies:Object.fromEntries(config.dependencies.filter(e=>e.source===d.service).map(e=>[e.target,`http://${e.target}.${context.namespace}.svc.cluster.local:8080`]))}));
 await writeFile(path.join(root,`artifacts/local-helm/${project.id}.yaml`),yaml({project:project.id,context:context.id,services}));
}
console.log('Local image overrides written under artifacts/local-helm. No cluster contacted.');
