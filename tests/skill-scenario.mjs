import {cp,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await mkdtemp(path.join(os.tmpdir(),'archi-skill-'));
try{
 await cp(fileURLToPath(new URL('..',import.meta.url)),root,{recursive:true,filter:p=>!['.git','artifacts','node_modules'].some(segment=>p.split(path.sep).includes(segment))});
 const file=path.join(root,'config/system.json'),config=JSON.parse(await readFile(path.join(root,'tests/fixtures/system.json'),'utf8'));
 config.services.push({id:'returns',name:'Returns Service',project:'fulfillment',layer:'integration',port:8110,repoPath:'services/returns',description:'Coordinates fictional returns'});
 config.dependencies.push({id:'dep-returns',source:'orders',target:'returns',protocol:'gRPC',label:'Request return',evidence:'design-spec'});
 for(const context of config.contexts)config.deployments.push({id:`${context.id}--returns`,service:'returns',context:context.id,image:{repository:'example.invalid/archi/returns',tag:'1.0.0'},replicas:1,sourceCommit:null,evidence:'design-spec',links:{}});
 await writeFile(file,JSON.stringify(config,null,2)+'\n');
 await cp(path.join(root,'tests/fixtures/observations.json'),path.join(root,'config/observations.json'));
 const run=spawnSync(process.execPath,['.agents/skills/archi-system-design/scripts/setup.mjs','--root',root],{cwd:root,encoding:'utf8'});
 console.log(run.stdout);console.log(run.stderr);if(run.status!==0)throw new Error('Skill extension scenario failed');
 const graph=JSON.parse(await readFile(path.join(root,'web/data.json'),'utf8'));
 const added=graph.instances.filter(d=>d.service==='returns');
 if(added.length!==3||added.some(d=>d.sourceCommit!==null||d.status!=='unknown'))throw new Error('Invented observation or commit');
 console.log('Skill extension scenario passed: ninth service, 3 unknown observations, generated project/Helm/runtime consistent');
}finally{await rm(root,{recursive:true,force:true});}
