import {createConfigurationFixture} from './configuration-fixture.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from 'yaml';

export async function createPlaceholderFixture(destination) {
  const f=await createConfigurationFixture(destination);
  for(const env of f.manifest.environments) {
    const file=path.join(f.root,'deploy',`portal-${env.id}.yaml`);
    await writeFile(file,stringify({
      'gateway.peer.host':'${routing.host}',
      'routing.host':`api.sales-${env.id}.svc.cluster.local`,
      'gateway.peer.port':'${routing.port:8080}',
    }));
    const valuesFile=path.join(f.root,'deploy','values',env.id,'portal.yaml');
    const values=parse(await readFile(valuesFile,'utf8'));
    values.extraEnv=[{name:'PEER_PORT',value:'9000'}];values.application={'routing.port':'${preferred.port:8080}'};
    await writeFile(valuesFile,stringify(values));
    const instance=env.instances.find(i=>i.service==='portal');
    instance.configuration={adapter:'spring-properties/3',environmentBindings:[{name:'PEER_PORT',key:'routing.port'}]};
  }
  const git=args=>execFileSync('git',['-C',path.join(f.root,'deploy'),...args],{encoding:'utf8',env:{...process.env,
    GIT_AUTHOR_NAME:'Archi fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Archi fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',
    GIT_AUTHOR_DATE:'2026-09-29T01:00:00Z',GIT_COMMITTER_DATE:'2026-09-29T01:00:00Z'}});
  git(['add','.']);git(['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Synthetic placeholder scenario']);
  f.manifest.repositories.find(r=>r.id==='deploy').revision=git(['rev-parse','HEAD']).trim();
  f.manifest.name='Synthetic placeholder resolution · scoped defaults and evidence';
  const accepted=structuredClone(f.manifest);
  accepted.services.find(s=>s.id==='portal').source.reviews=f.accepted.services.find(s=>s.id==='portal').source.reviews;
  await writeFile(f.path,JSON.stringify(f.manifest,null,2)+'\n');
  await writeFile(path.join(f.root,'accepted.json'),JSON.stringify(accepted,null,2)+'\n');
  return {...f,accepted};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{if(process.argv.length!==3)throw Error('Usage: node scripts/placeholder-fixture.mjs NEW_DESTINATION');console.log((await createPlaceholderFixture(path.resolve(process.argv[2]))).path);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
