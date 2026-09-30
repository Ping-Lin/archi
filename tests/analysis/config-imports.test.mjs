import test from 'node:test';
import assert from 'node:assert/strict';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createConfigImportsFixture} from '../../scripts/config-imports-fixture.mjs';
import {captureSystem} from '../../src/analysis/repositories.mjs';
import {validateSystem} from '../../src/analysis/system-contract.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';
function context(){return {
  files:new Map([['app.properties','peer.port=7000\nspring.config.import=first.properties,second.yaml\n'],['first.properties','peer.port=8000\n'],['second.yaml','peer:\n  port: 8080\n']]),
  env:{id:'qa',profiles:['qa'],propertyFiles:['app.properties'],propertiesComplete:true,environmentBindings:[],importProfilePolicy:'no-variants-reviewed',importBindings:[{from:'app.properties',location:'first.properties',file:'first.properties'},{from:'app.properties',location:'second.yaml',file:'second.yaml'}]},
  source:{service:'portal'},ledger:createLedger('qa','portal'),resources:[{kind:'Deployment',key:'workload',service:'portal',spec:{template:{spec:{containers:[{env:[{name:'SPRING_PROFILES_ACTIVE',value:'qa'}]}]}}}}],
};}
test('v5 imports override their declaring document in list order and retain evidence',()=>{
  const c=context(),p=runAdapter('spring-properties/5',c);
  assert.equal(p.complete,true);assert.equal(p.values['peer.port'],'8080');
  assert.deepEqual(p.chains['peer.port'].map(id=>c.ledger.facts.find(f=>f.id===id).value.value),['7000','8000','8080']);
  const facts=c.ledger.facts.filter(f=>f.predicate==='configuration.import');assert.equal(facts.length,2);
  assert.ok(facts.every(f=>f.evidenceIds.length===2&&p.referenceFactIds.includes(f.id)));
  assert.equal(runAdapter('spring-properties/4',context()).complete,false);
});
test('unbound, missing, duplicate, cyclic, profile-variant and unsupported imports stay incomplete',()=>{
  const edits=[
    c=>c.env.importBindings=[],
    c=>c.files.delete('first.properties'),
    c=>c.env.importBindings.push({...c.env.importBindings[0]}),
    c=>{c.files.set('first.properties','spring.config.import=app.properties');c.env.importBindings.push({from:'first.properties',location:'app.properties',file:'app.properties'});},
    c=>{c.files.set('app.properties','spring.config.import=first.properties,first.properties');},
    c=>c.files.set('first-qa.properties','peer.port=9999'),
    c=>delete c.env.importProfilePolicy,
    c=>{c.files.set('first.properties','spring.config.activate.on-profile=qa\npeer.port=9999');},
    c=>{c.env.importBindings[0].file='second.yaml';},
    ...['optional:missing.properties','../escape.properties','https://example.invalid/a.properties','configtree:/run/secrets/','${dynamic}','file:/tmp/a.properties',''].map(location=>c=>c.files.set('app.properties','spring.config.import='+location)),
  ];
  for(const edit of edits){const c=context();edit(c);assert.equal(runAdapter('spring-properties/5',c).complete,false,edit.toString());}
});
let helm=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required');
test('system import bindings capture pinned bytes, enforce schema, and compose deterministic evidence',{skip:!helm},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-imports-'));
  try{
    const f=await createConfigImportsFixture(path.join(root,'inputs'));
    const captured=await captureSystem(f.root,'accepted.json');
    assert.match(captured.files.get('deploy/routing-qa.properties'),/imported.host/);
    await writeFile(path.join(f.root,'deploy','routing-qa.properties'),'imported.host=evil.invalid');
    const first=await analyzeSystem(f.root,'accepted.json'),again=await analyzeSystem(f.root,'accepted.json');
    assert.deepEqual(first.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const qa=first.snapshots.find(s=>s.environment==='qa');assert.equal(qa.dependencies.filter(e=>e.source==='portal'&&e.target==='orders').length,2);
    const fact=qa.facts.find(f=>f.predicate==='configuration.import');assert.equal(fact.value.target,'deploy/routing-qa.properties');
    assert.ok(fact.evidenceIds.some(id=>qa.evidence.find(e=>e.id===id)?.provenance?.path==='routing-qa.properties'));
    assert.ok(qa.inputLock.files['deploy/routing-qa.properties']);
    for(const edit of [c=>delete c.importProfilePolicy,c=>c.importBindings.push({...c.importBindings[0]}),c=>c.importBindings[0].file.path='../escape.properties',c=>c.importBindings[0].file.repository='missing']){
      const m=structuredClone(f.accepted);edit(m.environments[0].instances[0].configuration);assert.throws(()=>validateSystem(m));
    }
    const m=structuredClone(f.accepted);m.environments[0].instances[0].configuration.importBindings=[];
    await writeFile(path.join(f.root,'unbound.json'),JSON.stringify(m));
    assert.equal((await analyzeSystem(f.root,'unbound.json')).snapshots[0].dependencies.some(e=>e.source==='portal'),false);
  }finally{await rm(root,{recursive:true,force:true});}
});
