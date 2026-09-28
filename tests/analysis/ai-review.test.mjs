import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createAiFixture} from '../../scripts/ai-candidates-fixture.mjs';
import {captureSystem} from '../../src/analysis/repositories.mjs';
import {reviewQueue, applyCandidateReview} from '../../src/analysis/ai-review.mjs';
let root, f, inputs, service, request;
before(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),'archi-review-'));
  f=await createAiFixture(path.join(root,'inputs'));
  inputs=await captureSystem(f.root,'system.json');
  service=inputs.manifest.services.find(s=>s.id==='portal');
  const row=reviewQueue(inputs,service).candidates[0];
  request={candidate:row.id,hash:row.candidateHash,environment:'qa',instance:'portal',decision:'accepted',reviewer:'Fixture reviewer',reason:'Synthetic review test'};
});
after(async()=>{if(root)await rm(root,{recursive:true,force:true});});
test('queue exposes citations, conditions, scoped reviews and stale declarations without Helm',()=>{
  const queue=reviewQueue(inputs,service);
  assert.equal(queue.candidates.length,2);
  assert.ok(queue.candidates.every(c=>c.status==='unreviewed'&&c.evidence[0].quote));
  const stale=structuredClone(service);
  stale.source.reviews=[{candidateHash:'0'.repeat(64),environment:'qa',instance:'portal',decision:'accepted',reviewer:'fixture',reason:'stale'}];
  assert.equal(reviewQueue(inputs,stale).staleReviews.length,1);
});
test('review is immutable, scope-limited, replaceable and revocable',()=>{
  const original=JSON.stringify(inputs.manifest);
  const result=applyCandidateReview(inputs,service,request);
  assert.equal(JSON.stringify(inputs.manifest),original);
  const next={...inputs,manifest:result.manifest};
  const nextService=next.manifest.services.find(s=>s.id==='portal');
  assert.deepEqual(reviewQueue(next,nextService).candidates.map(c=>c.status),['accepted','unreviewed']);
  const rejected=applyCandidateReview(next,nextService,{...request,decision:'rejected'});
  assert.equal(rejected.manifest.services.find(s=>s.id==='portal').source.reviews.length,1);
  assert.equal(rejected.change.previous.decision,'accepted');
  const removed=applyCandidateReview(next,nextService,{...request,decision:'unreviewed'});
  assert.deepEqual(removed.manifest.services.find(s=>s.id==='portal').source.reviews,[]);
});
test('review rejects stale hashes, wrong scopes, invalid decisions and blank identity',()=>{
  for(const patch of [{hash:'0'.repeat(64)},{candidate:'missing'},{environment:'missing'},{instance:'orders'},
    {decision:'approve-all'},{reviewer:' '},{reason:' '}])
    assert.throws(()=>applyCandidateReview(inputs,service,{...request,...patch}));
  assert.throws(()=>reviewQueue(inputs,inputs.manifest.services.find(s=>s.id!=='portal')),/ai-evidence/);
});
test('CLI reviews pinned input and writes a new manifest without changing existing files',async()=>{
  const common=['--root',f.root,'--system','system.json','--service','portal'];
  const run=args=>execFileSync(process.execPath,['scripts/ai-candidates.mjs',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const queue=JSON.parse(run(['queue',...common]));assert.equal(queue.candidates.length,2);
  const before=await readFile(f.path,'utf8'),out=path.join(root,'reviewed.json');
  const args=['review',...common,...Object.entries(request).flatMap(([k,v])=>['--'+k,v]),'--out',out];
  const result=JSON.parse(run(args));assert.equal(result.change.requested.decision,'accepted');
  const written=JSON.parse(await readFile(out,'utf8'));
  assert.equal(written.services.find(s=>s.id==='portal').source.reviews.length,1);
  assert.equal(await readFile(f.path,'utf8'),before);
  assert.throws(()=>run(args));
  assert.throws(()=>run(['queue',...common,'--decision','accepted']));
});
