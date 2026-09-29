import {createPlaceholderFixture} from './placeholder-fixture.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from 'yaml';
import {hash} from '../src/analysis/contract.mjs';
import {candidateHash} from '../src/analysis/ai-candidates.mjs';

export async function createGrpcFixture(destination) {
  const f=await createPlaceholderFixture(destination);
  const commit=id=>{
    const git=args=>execFileSync('git',['-C',path.join(f.root,id),...args],{encoding:'utf8',env:{...process.env,
      GIT_AUTHOR_NAME:'Archi fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Archi fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',
      GIT_AUTHOR_DATE:'2026-09-29T02:00:00Z',GIT_COMMITTER_DATE:'2026-09-29T02:00:00Z'}});
    git(['add','.']);git(['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Synthetic gRPC endpoints']);
    f.manifest.repositories.find(r=>r.id===id).revision=git(['rev-parse','HEAD']).trim();
  };
  const source='// Synthetic source specimen, not compiled or executed.\nclass Clients(private val config: Map<String, String>) {\n    fun split() = ManagedChannelBuilder.forAddress(config.getValue("gateway.peer.host"), config.getValue("gateway.peer.port").toInt()).build()\n    fun dns() = ManagedChannelBuilder.forTarget(config.getValue("grpc.orders.target")).build()\n}\n';
  await writeFile(path.join(f.root,'portal','Clients.kt'),source);commit('portal');
  const bundle={schemaVersion:'archi/ai-candidates-v1alpha3',simulation:true,service:'portal',candidates:[
    {id:'split',name:'split',endpoint:{kind:'host-port',hostKey:'gateway.peer.host',portKey:'gateway.peer.port'}},
    {id:'dns',name:'dns',endpoint:{kind:'grpc-dns',key:'grpc.orders.target'}},
  ].map((c,i)=>({...c,protocol:'gRPC',conditions:[],unknowns:[],evidence:[{repository:'portal',path:'Clients.kt',revision:f.manifest.repositories.find(r=>r.id==='portal').revision,contentHash:hash(source),startLine:i+3,endLine:i+3,quote:source.split('\n')[i+2]}]}))};
  await writeFile(path.join(f.root,'deploy','ai-candidates.json'),JSON.stringify(bundle,null,2)+'\n');
  const chart=path.join(f.root,'deploy','chart','templates','app.yaml');
  await writeFile(chart,(await readFile(chart,'utf8')).replaceAll('8080','{{ .Values.port | default 8080 }}'));
  for(const env of f.manifest.environments) {
    const portal=path.join(f.root,'deploy','values',env.id,'portal.yaml'),values=parse(await readFile(portal,'utf8'));
    values.application={'routing.port':'${preferred.port:9090}','grpc.orders.target':`dns:///api.sales-${env.id}.svc.cluster.local:9090`};
    await writeFile(portal,stringify(values));
    const orders=path.join(f.root,'deploy','values',env.id,'orders.yaml'),target=parse(await readFile(orders,'utf8'));target.port=9090;
    await writeFile(orders,stringify(target));
    env.instances.find(i=>i.id==='orders').endpoint={name:'api',port:9090,protocol:'gRPC',kind:'service'};
  }
  commit('deploy');
  f.manifest.services.find(s=>s.id==='portal').source.adapter='ai-evidence/3';
  f.manifest.name='Synthetic gRPC · DNS and split endpoint identities';
  const accepted=structuredClone(f.manifest);
  accepted.services.find(s=>s.id==='portal').source.reviews=bundle.candidates.map(c=>({candidateHash:candidateHash(bundle,c),environment:'qa',instance:'portal',decision:'accepted',reviewer:'synthetic-reviewer',reason:'Authored fixture only; not a real human approval.'}));
  await writeFile(f.path,JSON.stringify(f.manifest,null,2)+'\n');
  await writeFile(path.join(f.root,'accepted.json'),JSON.stringify(accepted,null,2)+'\n');
  return {...f,bundle,accepted};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{if(process.argv.length!==3)throw Error('Usage: node scripts/grpc-fixture.mjs NEW_DESTINATION');console.log((await createGrpcFixture(path.resolve(process.argv[2]))).path);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
