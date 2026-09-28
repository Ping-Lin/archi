import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {createAiFixture} from '../../scripts/ai-candidates-fixture.mjs';
import {captureSystem} from '../../src/analysis/repositories.mjs';
import {verifyAiBundle,candidateHash,extractAiCandidates} from '../../src/analysis/ai-candidates.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';
import {validateSystem} from '../../src/analysis/system-contract.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';
import {resolveCandidates} from '../../src/analysis/resolve.mjs';
let root,f,inputs,service;let helm=true;
try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required for AI candidate integration');
before(async()=>{root=await mkdtemp(path.join(os.tmpdir(),'archi-ai-'));f=await createAiFixture(path.join(root,'inputs'));inputs=await captureSystem(f.root,'system.json');service=f.manifest.services.find(s=>s.id==='portal');});
after(async()=>{if(root)await rm(root,{recursive:true,force:true});});
const verify=b=>verifyAiBundle(b,{service,simulation:true,files:inputs.files,provenance:inputs.provenance});
test('AI template verifies pinned source evidence and rejects forgery, stale bytes, scope and extra answers',()=>{
 verify(f.bundle);
 for(const edit of [b=>b.service='orders',b=>b.simulation=false,b=>b.candidates[0].targetService='orders',b=>b.candidates.push(b.candidates[0]),
  b=>b.candidates[0].evidence[0].quote='invented',b=>b.candidates[0].evidence[0].revision='0'.repeat(40),b=>b.candidates[0].evidence[0].contentHash='0'.repeat(64),
  b=>b.candidates[0].evidence[0].path='../Clients.kt',b=>b.candidates[0].evidence[0].startLine=999,b=>b.candidates[0].conditions=[{kind:'arbitrary',value:'run'}]]){
  const b=structuredClone(f.bundle);edit(b);assert.throws(()=>verify(b));
 }
});
test('reviews require exact candidate and service/environment/instance scope',()=>{
 validateSystem(f.accepted);
 const bad=structuredClone(f.accepted);bad.services.find(s=>s.id==='portal').source.reviews[0].instance='orders';assert.throws(()=>validateSystem(bad),/scope/);
 const stale=structuredClone(service);stale.source.reviews=[{...f.accepted.services[0].source.reviews[0],candidateHash:'0'.repeat(64)}];
 assert.throws(()=>extractAiCandidates({files:inputs.files,source:{service:'portal',candidateFile:'deploy/ai-candidates.json',files:['portal/Clients.kt']},env:{id:'qa'},ledger:createLedger('qa','portal'),service:stale,simulation:true,provenance:inputs.provenance}),/Stale AI review/);
 const changed=structuredClone(f.bundle.candidates[0]);changed.endpointKey='another.key';assert.notEqual(candidateHash(f.bundle,changed),candidateHash(f.bundle,f.bundle.candidates[0]));
});
test('template/check CLI is offline and refuses to overwrite templates',async()=>{
 const run=args=>execFileSync(process.execPath,['scripts/ai-candidates.mjs',...args],{encoding:'utf8'});
 const common=['--root',f.root,'--system','system.json','--service','portal'];const out=path.join(root,'template.json');
 run(['template',...common,'--out',out]);assert.equal(JSON.parse(await readFile(out,'utf8')).candidates[0].protocol,'unknown');
 assert.throws(()=>run(['template',...common,'--out',out]));
 assert.match(run(['check',...common,'--bundle',path.join(f.root,'deploy','ai-candidates.json')]),/semantics unverified/);
});
test('accepted AI review cannot bypass unknowns, protocol support, conditions or incomplete properties',()=>{
 for(const variant of ['unknowns','grpc','protocol-mismatch','inactive','inactive-mismatch','incomplete']){
  const bundle=structuredClone(f.bundle),c=bundle.candidates[0],s=structuredClone(service);
  if(variant==='unknowns')c.unknowns=['Dynamic client selection unresolved'];
  if(variant==='grpc')c.protocol='gRPC';
  if(variant==='protocol-mismatch'||variant==='inactive-mismatch')c.protocol='HTTPS';
  if(variant.startsWith('inactive'))c.conditions=[{kind:'profile',value:'production'}];
  s.source.reviews=[{candidateHash:candidateHash(bundle,c),environment:'qa',instance:'portal',decision:'accepted',reviewer:'specimen',reason:'Synthetic assertion'}];
  const files=new Map(inputs.files);files.set('deploy/ai-candidates.json',JSON.stringify(bundle));
  const ledger=createLedger('qa','portal'),env={id:'qa',profiles:['qa'],targets:[]};
  const extracted=extractAiCandidates({files,source:{service:'portal',candidateFile:'deploy/ai-candidates.json',files:['portal/Clients.kt']},env,ledger,service:s,simulation:true,provenance:inputs.provenance});
  const properties={complete:variant!=='incomplete',values:{'downstream.url':'http://orders:8080'},chains:{},scopeFact:ledger.fact('scope','qa',{},[])};
  const result=resolveCandidates(extracted,properties,env,[],{coverage:'unavailable',runtime:[]},ledger,url=>({matches:url?[{id:'orders',kind:'service',url}]:[],factIds:[],reasons:[]}));
  assert.equal(result.dependencies.length,0,variant);
  if(variant.startsWith('inactive'))assert.equal(result.candidates[0].eligibility,'disabled',variant);
 }
});
test('unreviewed candidates map endpoints without edges; accepted review affects QA only and is deterministic', {skip:!helm},async()=>{
 const run=m=>analyzeSystem(f.root,m,{asOf:'2026-09-28T00:00:00Z'});
 const unreviewed=await run('system.json'),accepted=await run('accepted.json');
 for(const s of unreviewed.snapshots){const c=s.candidates.find(c=>c.source==='portal');assert.equal(c.eligibility,'unknown');assert.equal(c.target,'orders');assert.equal(c.extraction.status,'unreviewed');assert.ok(!s.dependencies.some(e=>e.source==='portal'));}
 const qa=accepted.snapshots.find(s=>s.environment==='qa'),prod=accepted.snapshots.find(s=>s.environment==='production');
 assert.equal(qa.candidates.find(c=>c.source==='portal').eligibility,'enabled');assert.equal(qa.dependencies.find(e=>e.source==='portal').extraction.status,'accepted');
 assert.ok(!prod.dependencies.some(e=>e.source==='portal'));assert.equal(prod.candidates.find(c=>c.source==='portal').extraction.status,'unreviewed');
 const again=await run('accepted.json');assert.deepEqual(again.snapshots.map(s=>s.contentHash),accepted.snapshots.map(s=>s.contentHash));
 const rejected=structuredClone(f.accepted);rejected.services.find(s=>s.id==='portal').source.reviews[0].decision='rejected';
 await writeFile(path.join(f.root,'rejected.json'),JSON.stringify(rejected));const result=await run('rejected.json');assert.ok(!result.snapshots[0].dependencies.some(e=>e.source==='portal'));
});

test('same physical repository supports independent source and candidate revision bindings',async()=>{
 const manifest=structuredClone(f.manifest),sourceRepo=manifest.repositories.find(r=>r.id==='portal');
 const location=path.join(f.root,sourceRepo.path);
 await writeFile(path.join(location,'ai-candidates.json'),JSON.stringify(f.bundle));
 const git=args=>execFileSync('git',['-C',location,...args],{encoding:'utf8'});
 git(['add','ai-candidates.json']);
 git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Candidate input after source']);
 const revision=git(['rev-parse','HEAD']).trim();
 assert.notEqual(revision,sourceRepo.revision);
 manifest.repositories.push({...sourceRepo,id:'candidate-inputs',revision});
 manifest.services.find(s=>s.id==='portal').source.candidateFile={repository:'candidate-inputs',path:'ai-candidates.json'};
 await writeFile(path.join(f.root,'same-repo.json'),JSON.stringify(manifest));
 const captured=await captureSystem(f.root,'same-repo.json');
 verifyAiBundle(JSON.parse(captured.files.get('candidate-inputs/ai-candidates.json')),{service:manifest.services.find(s=>s.id==='portal'),simulation:true,files:captured.files,provenance:captured.provenance});
 assert.equal(captured.provenance['portal/Clients.kt'].revision,sourceRepo.revision);
 assert.equal(captured.provenance['candidate-inputs/ai-candidates.json'].revision,revision);
});
