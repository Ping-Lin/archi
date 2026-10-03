import test from 'node:test';
import assert from 'node:assert/strict';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createConfigImportsFixture} from '../../scripts/config-imports-fixture.mjs';
import {captureSystem} from '../../src/analysis/repositories.mjs';
import {validateSystem} from '../../src/analysis/system-contract.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';

function context(){return {
  files:new Map([['application.properties','peer.port=7000\nspring.config.import=extra.properties'],['extra.properties','peer.port=7100'],['extra-qa.properties','peer.port=7200'],['application-qa.properties','peer.port=7300'],['application-blue.properties','peer.port=7400']]),
  env:{id:'qa',profiles:['qa','blue'],propertyFiles:['application.properties'],propertiesComplete:true,environmentBindings:[],importProfilePolicy:'explicit-variants-reviewed',importBindings:[{from:'application.properties',location:'extra.properties',file:'extra.properties'}],profileBindings:[
    {from:'application.properties',profile:'qa',file:'application-qa.properties'},
    {from:'application.properties',profile:'blue',file:'application-blue.properties'},
    {from:'extra.properties',profile:'qa',file:'extra-qa.properties'},
    {from:'extra.properties',profile:'blue',file:null},
  ]},source:{service:'portal'},ledger:createLedger('qa','portal'),
  resources:[{kind:'Deployment',key:'workload',service:'portal',spec:{template:{spec:{containers:[{env:[{name:'SPRING_PROFILES_ACTIVE',value:'qa,blue'}]}]}}}}],
};}
test('v8 applies explicit root and import variants in profile order with evidence',()=>{
  const c=context(),p=runAdapter('spring-properties/8',c);
  assert.equal(p.complete,true,JSON.stringify(p.diagnostics));
  assert.equal(p.values['peer.port'],'7200');
  const facts=c.ledger.facts.filter(f=>f.predicate==='configuration.profile');
  assert.equal(facts.length,4);assert.ok(facts.every(f=>p.referenceFactIds.includes(f.id)));
  assert.equal(facts.filter(f=>f.value.status==='reviewed-absent').length,1);
  assert.equal(runAdapter('spring-properties/5',context()).complete,false);
});
test('v8 rejects profile order mismatches even when profile membership is equal',()=>{
  const c=context();c.resources[0].spec.template.spec.containers[0].env[0].value='blue,qa';
  const p=runAdapter('spring-properties/8',c);assert.equal(p.complete,false);
  assert.ok(p.diagnostics.some(d=>d.code==='PROFILE_MISMATCH'));
});
test('v8 profile failures never produce complete scope',()=>{
  for(const edit of [
    c=>c.env.profileBindings.pop(),
    c=>c.env.profileBindings.push({...c.env.profileBindings[0]}),
    c=>c.files.delete('application-qa.properties'),
    c=>c.env.profileBindings[0].file=null,
    c=>c.env.profileBindings[0].file='other.yaml',
    c=>c.env.profileBindings.push({from:'unused.properties',profile:'qa',file:null}),
    c=>c.files.set('extra-blue.properties','peer.port=9999'),
    c=>c.files.set('application-qa.properties','spring.profiles.include=other'),
    c=>c.files.set('application-qa.properties','spring.config.activate.on-profile=qa'),
    c=>c.env.profiles=['../escape'],
  ]){const c=context();edit(c);assert.equal(runAdapter('spring-properties/8',c).complete,false,edit.toString());}
});
test('v8 imports declared by a profile file remain bound and traversed',()=>{
  const c=context();c.files.set('application-blue.properties','spring.config.import=leaf.properties');c.files.set('leaf.properties','peer.port=7500');
  c.env.importBindings.push({from:'application-blue.properties',location:'leaf.properties',file:'leaf.properties'});
  for(const profile of c.env.profiles)c.env.profileBindings.push({from:'leaf.properties',profile,file:null});
  const p=runAdapter('spring-properties/8',c);assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.port'],'7200');
});
test('v8 supports explicitly reviewed default-profile variants',()=>{
  const c=context();c.env.profiles=[];c.env.importBindings=[];c.files=new Map([['application.properties','peer.port=7000'],['application-default.properties','peer.port=7600']]);
  c.env.profileBindings=[{from:'application.properties',profile:'default',file:'application-default.properties'}];
  c.resources[0].spec.template.spec.containers[0].env[0].value='';
  const p=runAdapter('spring-properties/8',c);assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.port'],'7600');
});
let helm=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required');
test('v8 captures profile files at pinned revisions and composes deterministic snapshots',{skip:!helm},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-profiles-'));
  try{
    const f=await createConfigImportsFixture(path.join(root,'inputs')),m=structuredClone(f.accepted);
    const instance=m.environments[0].instances.find(i=>i.id==='portal'),c=instance.configuration;
    c.adapter='spring-properties/8';c.importProfilePolicy='explicit-variants-reviewed';
    const profile=instance.profiles[0],base=c.importBindings[0].file,variant={repository:'deploy',path:'reviewed-profile.properties'};
    await writeFile(path.join(f.root,'deploy',variant.path),'profile.marker=pinned\n');
    const git=args=>execFileSync('git',['-C',path.join(f.root,'deploy'),...args],{encoding:'utf8'});
    git(['add',variant.path]);git(['-c','user.name=Archi fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','Profile fixture']);
    m.repositories.find(r=>r.id==='deploy').revision=git(['rev-parse','HEAD']).trim();
    c.profileBindings=[...instance.propertyFiles,...c.importBindings.map(b=>b.file)].flatMap(from=>instance.profiles.map(p=>({from,profile:p,file:from.repository===base.repository&&from.path===base.path&&p===profile?variant:null})));
    const manifest=path.join(f.root,'profiles.json');await writeFile(manifest,JSON.stringify(m));
    const capture=await captureSystem(f.root,'profiles.json');assert.equal(capture.files.get('deploy/'+variant.path),'profile.marker=pinned\n');
    await writeFile(path.join(f.root,'deploy',variant.path),'profile.marker=dirty');
    const first=await analyzeSystem(f.root,'profiles.json'),again=await analyzeSystem(f.root,'profiles.json');
    assert.deepEqual(first.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const qa=first.snapshots[0];assert.ok(qa.inputLock.files['deploy/'+variant.path]);
    assert.ok(qa.facts.some(f=>f.predicate==='property.value'&&f.subject==='profile.marker'&&f.value.value==='pinned'));
    assert.equal(qa.dependencies.filter(e=>e.source==='portal'&&e.target==='orders').length,2);
    assert.ok(qa.facts.some(f=>f.predicate==='configuration.profile'&&f.value.status==='bound'));
    const incomplete=structuredClone(m);incomplete.environments[0].instances.find(i=>i.id==='portal').configuration.profileBindings.pop();
    await writeFile(path.join(f.root,'incomplete.json'),JSON.stringify(incomplete));
    assert.equal((await analyzeSystem(f.root,'incomplete.json')).snapshots[0].dependencies.some(e=>e.source==='portal'),false);
    for(const edit of [c=>c.profileBindings.push({...c.profileBindings[0]}),c=>c.profileBindings[0].profile='inactive',c=>c.profileBindings[0].file={repository:'missing',path:'a.properties'},c=>c.profileBindings[0].from.path='../escape']){
      const invalid=structuredClone(m);edit(invalid.environments[0].instances.find(i=>i.id==='portal').configuration);assert.throws(()=>validateSystem(invalid));
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
