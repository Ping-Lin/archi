import { createCrossRepoFixture } from './cross-repo-fixture.mjs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '../src/analysis/contract.mjs';
import { candidateHash } from '../src/analysis/ai-candidates.mjs';
export async function createAiFixture(destination){
 const f=await createCrossRepoFixture(destination);
 const commit=(id,message)=>{
  const git=args=>execFileSync('git',['-C',path.join(f.root,id),...args],{encoding:'utf8',env:{...process.env,
   GIT_AUTHOR_NAME:'Archi fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Archi fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',GIT_AUTHOR_DATE:'2026-09-28T00:00:00Z',GIT_COMMITTER_DATE:'2026-09-28T00:00:00Z'}});
  git(['add','.']);git(['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m',message]);
  f.manifest.repositories.find(r=>r.id===id).revision=git(['rev-parse','HEAD']).trim();
 };
 const source='// Synthetic Kotlin specimen; not compiled or executed.\nclass Clients(private val config: Map<String, String>) {\n    fun downstream() = HttpClient(config.getValue("downstream.url"))\n}\n';
 await writeFile(path.join(f.root,'portal','Clients.kt'),source);commit('portal','Synthetic Kotlin input');
 const bundle={schemaVersion:'archi/ai-candidates-v1alpha1',simulation:true,service:'portal',candidates:[{
  id:'downstream',name:'downstream',endpointKey:'downstream.url',protocol:'HTTP',conditions:[],unknowns:[],evidence:[{
   repository:'portal',revision:f.manifest.repositories.find(r=>r.id==='portal').revision,path:'Clients.kt',contentHash:hash(source),startLine:3,endLine:3,quote:source.split('\n')[2],
  }],
 }]};
 await writeFile(path.join(f.root,'deploy','ai-candidates.json'),JSON.stringify(bundle,null,2)+'\n');commit('deploy','Synthetic AI candidate specimen');
 f.manifest.services.find(s=>s.id==='portal').source={adapter:'ai-evidence/1',files:[{repository:'portal',path:'Clients.kt'}],candidateFile:{repository:'deploy',path:'ai-candidates.json'},reviews:[]};
 f.manifest.name='Synthetic AI candidate review · Kotlin source specimen';
 await writeFile(f.path,JSON.stringify(f.manifest,null,2)+'\n');
 const accepted=structuredClone(f.manifest);
 accepted.services.find(s=>s.id==='portal').source.reviews=[{candidateHash:candidateHash(bundle,bundle.candidates[0]),environment:'qa',instance:'portal',decision:'accepted',reviewer:'synthetic-reviewer',reason:'Authored scenario: the configured key is used by this client. This is not a real code review.'}];
 await writeFile(path.join(f.root,'accepted.json'),JSON.stringify(accepted,null,2)+'\n');
 return {...f,bundle,accepted};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==3)throw Error('Usage: node scripts/ai-candidates-fixture.mjs NEW_DESTINATION');const f=await createAiFixture(path.resolve(process.argv[2]));console.log(`Synthetic AI input created: ${f.path}`);}catch(e){console.error(e.message);process.exitCode=1;}
}
