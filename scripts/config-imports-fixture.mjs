import {createConfigMapFixture} from './configmap-fixture.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from 'yaml';
export async function createConfigImportsFixture(destination){
  const f=await createConfigMapFixture(destination);
  for(const env of f.manifest.environments){
    const from={repository:'deploy',path:`portal-${env.id}.yaml`},location=`routing-${env.id}.properties`,file={repository:'deploy',path:location};
    const overlay=parse(await readFile(path.join(f.root,'deploy',from.path),'utf8'));
    overlay['spring.config.import']=location;
    await writeFile(path.join(f.root,'deploy',from.path),stringify(overlay));
    await writeFile(path.join(f.root,'deploy',location),`gateway.peer.host=\${imported.host}\nimported.host=api.sales-${env.id}.svc.cluster.local\n`);
    const instance=env.instances.find(i=>i.id==='portal');
    instance.configuration={...instance.configuration,adapter:'spring-properties/5',importProfilePolicy:'no-variants-reviewed',importBindings:[{from,location,file}]};
  }
  const git=args=>execFileSync('git',['-C',path.join(f.root,'deploy'),...args],{encoding:'utf8',env:{...process.env,
    GIT_AUTHOR_NAME:'Archi fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Archi fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',
    GIT_AUTHOR_DATE:'2026-09-30T06:00:00Z',GIT_COMMITTER_DATE:'2026-09-30T06:00:00Z'}});
  git(['add','.']);git(['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Synthetic pinned config imports']);
  f.manifest.repositories.find(r=>r.id==='deploy').revision=git(['rev-parse','HEAD']).trim();
  f.manifest.name='Synthetic config imports · explicit pinned bindings';
  const accepted=structuredClone(f.manifest);
  accepted.services.find(s=>s.id==='portal').source.reviews=f.accepted.services.find(s=>s.id==='portal').source.reviews;
  await writeFile(f.path,JSON.stringify(f.manifest,null,2)+'\n');
  await writeFile(path.join(f.root,'accepted.json'),JSON.stringify(accepted,null,2)+'\n');
  return {...f,accepted};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{if(process.argv.length!==3)throw Error('Usage: node scripts/config-imports-fixture.mjs NEW_DESTINATION');console.log((await createConfigImportsFixture(path.resolve(process.argv[2]))).path);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
