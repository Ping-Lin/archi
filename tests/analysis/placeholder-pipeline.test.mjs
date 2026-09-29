import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {parse,stringify} from 'yaml';
import {createPlaceholderFixture} from '../../scripts/placeholder-fixture.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';
let helm=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required');
test('placeholder pipeline preserves evidence, review isolation, determinism and fail-closed cycles',{skip:!helm},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-placeholder-pipeline-'));
  try {
    const f=await createPlaceholderFixture(path.join(root,'inputs'));
    const run=()=>analyzeSystem(f.root,'accepted.json');
    const first=await run(),again=await run(),qa=first.snapshots.find(s=>s.environment==='qa');
    assert.deepEqual(first.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    assert.equal(qa.dependencies.find(d=>d.source==='portal').target,'orders');
    assert.equal(first.snapshots.find(s=>s.environment==='production').dependencies.some(d=>d.source==='portal'),false);
    const candidate=qa.candidates.find(c=>c.source==='portal');
    const explanation=qa.resolutions.find(r=>r.id===candidate.resolutionId);
    const facts=qa.facts.filter(f=>explanation.inputFactIds.includes(f.id));
    const port=facts.find(f=>f.predicate==='property.placeholder'&&f.subject==='gateway.peer.port');
    assert.equal(port.value.value,'8080');assert.deepEqual(port.value.defaultsUsed,['preferred.port']);
    assert.ok(facts.some(f=>f.subject==='routing.port'&&f.value.value==='9000'));
    assert.ok(port.evidenceIds.some(id=>qa.evidence.find(e=>e.id===id)?.provenance?.path==='portal-qa.yaml'));
    const location=path.join(f.root,'deploy'),file=path.join(location,'values','qa','portal.yaml');
    const values=parse(await readFile(file,'utf8'));values.application={'routing.port':'${gateway.peer.port}'};
    await writeFile(file,stringify(values));
    const git=args=>execFileSync('git',['-C',location,...args],{encoding:'utf8'});
    git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','-m','Synthetic cycle']);
    f.accepted.repositories.find(r=>r.id==='deploy').revision=git(['rev-parse','HEAD']).trim();
    await writeFile(path.join(f.root,'accepted.json'),JSON.stringify(f.accepted));
    const failed=(await run()).snapshots.find(s=>s.environment==='qa');
    assert.equal(failed.dependencies.some(d=>d.source==='portal'),false);
    assert.equal(failed.candidates.find(c=>c.source==='portal').eligibility,'unknown');
    assert.ok(failed.diagnostics.some(d=>d.code==='PLACEHOLDER_UNRESOLVED'&&/Circular/.test(d.message)));
  }finally{await rm(root,{recursive:true,force:true});}
});
