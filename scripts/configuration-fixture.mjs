import {createAiFixture} from './ai-candidates-fixture.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from 'yaml';
import {hash} from '../src/analysis/contract.mjs';
import {candidateHash} from '../src/analysis/ai-candidates.mjs';

export async function createConfigurationFixture(destination) {
  const f=await createAiFixture(destination);
  const commit=id=>{
    const git=args=>execFileSync('git',['-C',path.join(f.root,id),...args],{encoding:'utf8',env:{...process.env,
      GIT_AUTHOR_NAME:'Archi fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Archi fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',
      GIT_AUTHOR_DATE:'2026-09-29T00:00:00Z',GIT_COMMITTER_DATE:'2026-09-29T00:00:00Z'}});
    git(['add','.']);git(['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Synthetic configuration bindings']);
    f.manifest.repositories.find(r=>r.id===id).revision=git(['rev-parse','HEAD']).trim();
  };
  const source='// Synthetic source specimen, not compiled.\nclass Clients(private val config: Map<String, String>) {\n    fun downstream() = HttpClient(config.getValue("gateway.peer.host"), config.getValue("gateway.peer.port"))\n}\n';
  await writeFile(path.join(f.root,'portal','Clients.kt'),source);
  await writeFile(path.join(f.root,'portal','application.properties'),'gateway.peer.host=unused.example.invalid\ngateway.peer.port=7000\n');
  commit('portal');
  const javaFile=path.join(f.root,'orders','Clients.java');
  await writeFile(javaFile,(await readFile(javaFile,'utf8')).replaceAll('downstream.url','clients.stock.address'));commit('orders');
  const bundle={schemaVersion:'archi/ai-candidates-v1alpha2',simulation:true,service:'portal',candidates:[{
    id:'downstream',name:'downstream',endpoint:{kind:'host-port',hostKey:'gateway.peer.host',portKey:'gateway.peer.port'},protocol:'HTTP',conditions:[],unknowns:[],
    evidence:[{repository:'portal',path:'Clients.kt',revision:f.manifest.repositories.find(r=>r.id==='portal').revision,contentHash:hash(source),startLine:3,endLine:3,quote:source.split('\n')[2]}],
  }]};
  await writeFile(path.join(f.root,'deploy','ai-candidates.json'),JSON.stringify(bundle,null,2)+'\n');
  const chart=path.join(f.root,'deploy','chart','templates','app.yaml');
  await writeFile(chart,(await readFile(chart,'utf8')).replace('---\napiVersion: v1',`{{- range .Values.extraEnv }}
            - name: {{ .name | quote }}
              value: {{ .value | quote }}
{{- end }}
---
apiVersion: v1`));
  for(const env of f.manifest.environments) {
    await writeFile(path.join(f.root,'deploy',`portal-${env.id}.yaml`),stringify({'gateway.peer.host':`api.sales-${env.id}.svc.cluster.local`,'gateway.peer.port':8000}));
    await writeFile(path.join(f.root,'deploy',`orders-${env.id}.properties`),`clients.stock.address=http://api.stock-${env.id}.svc.cluster.local:8080\n`);
    const valuesFile=path.join(f.root,'deploy','values',env.id,'portal.yaml');
    const values=parse(await readFile(valuesFile,'utf8'));
    values.application={'gateway.peer.port':8080};
    values.extraEnv=[{name:'PEER_PORT',value:'9000'}];
    await writeFile(valuesFile,stringify(values));
    for(const instance of env.instances) {
      if(instance.service==='portal') {
        instance.configuration={adapter:'spring-properties/2',environmentBindings:[{name:'PEER_PORT',key:'gateway.peer.port'}]};
        instance.propertyFiles=[{repository:'portal',path:'application.properties'},{repository:'deploy',path:`portal-${env.id}.yaml`}];
      }else if(instance.service==='orders') {
        instance.configuration={adapter:'spring-properties/2',environmentBindings:[]};
        instance.propertyFiles=[{repository:'deploy',path:`orders-${env.id}.properties`}];
      }
    }
  }
  commit('deploy');
  const service=f.manifest.services.find(s=>s.id==='portal');service.source.adapter='ai-evidence/2';
  f.manifest.name='Synthetic configuration portability · independent project keys';
  await writeFile(f.path,JSON.stringify(f.manifest,null,2)+'\n');
  const accepted=structuredClone(f.manifest);
  accepted.services.find(s=>s.id==='portal').source.reviews=[{candidateHash:candidateHash(bundle,bundle.candidates[0]),environment:'qa',instance:'portal',decision:'accepted',reviewer:'synthetic-reviewer',reason:'Authored configuration scenario; not a real human approval.'}];
  await writeFile(path.join(f.root,'accepted.json'),JSON.stringify(accepted,null,2)+'\n');
  return {...f,bundle,accepted};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{if(process.argv.length!==3)throw Error('Usage: node scripts/configuration-fixture.mjs NEW_DESTINATION');console.log((await createConfigurationFixture(path.resolve(process.argv[2]))).path);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
