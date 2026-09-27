#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validate } from '../src/core/model.mjs';
import { generate, writeGenerated } from '../src/core/generate.mjs';
import { startDemo } from '../src/core/server.mjs';
const args=process.argv.slice(2), command=args[0]??'help';
const value=(flag,fallback)=>{const i=args.indexOf(flag);if(i===-1)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`${flag} requires a value`);return args[i+1];};
const root=path.resolve(value('--root',path.join(path.dirname(fileURLToPath(import.meta.url)),'..')));
try {
  if(!['validate','generate','check','serve','demo','helm'].includes(command)){
    console.log('Archi: validate | generate | check | serve | demo | helm [--root PATH] [--port 4173]');
    if(command!=='help')process.exitCode=1;
  }else{
    const config=JSON.parse(await readFile(path.join(root,'config/system.json'),'utf8'));
    const snapshot=JSON.parse(await readFile(path.join(root,'config/observations.json'),'utf8'));
    validate(config,snapshot);
    if(command==='validate')console.log(`Valid: ${config.projects.length} projects, ${config.services.length} services, ${config.deployments.length} deployments`);
    if(['generate','check','serve','demo'].includes(command)){
      const changes=await writeGenerated(root,generate(config,snapshot),command==='check');
      if(command==='check'&&changes.length)throw new Error(`Generated outputs differ. Run npm run generate:\n${changes.join('\n')}`);
      if(command==='generate'||command==='check')console.log(`${command}: ${changes.length} changed files`);
    }
    if(command==='helm'){
      const version=spawnSync('helm',['version','--short'],{encoding:'utf8'});
      if(version.error||version.status!==0)throw new Error('Helm is required for this gate; install Helm 3 and rerun npm run check:helm');
      for(const c of config.contexts)for(const p of config.projects){
        const values=path.join(root,`generated/helm/${c.id}/${p.id}.yaml`),chart=path.join(root,'charts/project');
        for(const args of [['lint',chart,'-f',values,'--strict'],['template',p.id,chart,'-n',c.namespace,'-f',values]]){
          const result=spawnSync('helm',args,{encoding:'utf8'});
          if(result.status!==0)throw new Error(result.stderr||result.stdout);
        }
      }
      console.log('Helm lint and template: all project/context combinations passed');
    }
    if(command==='serve'||command==='demo'){
      const port=Number(value('--port','4173'));
      if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('port must be 1024..65535');
      const runtimePath=value('--runtime-config',null);
      const runtimeConfig=runtimePath?JSON.parse(await readFile(path.resolve(root,runtimePath),'utf8')):undefined;
      if(runtimeConfig)(await import('../src/runtime/refresh.mjs')).validateRefreshConfig(runtimeConfig);
      const demo=await startDemo(root,config,{port,mocks:command==='demo',runtimeConfig});
      console.log(`Archi explorer: ${demo.url}`);
      if(command==='demo')console.log(`HTTP simulation: http://127.0.0.1:${config.services[0].port}/simulate`);
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await demo.close();process.exit(0);});
    }
  }
}catch(error){console.error(error.message);process.exitCode=1;}
