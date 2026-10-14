import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesProfile,parseConfigDocuments} from '../../src/analysis/config-documents.mjs';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createMountedConfigFixture} from '../../scripts/mounted-config-fixture.mjs';
import {validateSystem} from '../../src/analysis/system-contract.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';

function context(text,file='application.properties'){
  return {files:new Map([[file,text]]),env:{id:'qa',profiles:['qa'],propertyFiles:[file],propertiesComplete:true,environmentBindings:[],importProfilePolicy:'explicit-variants-reviewed',importBindings:[],profileBindings:[{from:file,profile:'qa',file:null}]},source:{service:'portal'},ledger:createLedger('qa','portal'),resources:[{kind:'Deployment',key:'portal',service:'portal',spec:{template:{spec:{containers:[{env:[{name:'SPRING_PROFILES_ACTIVE',value:'qa'}]}]}}}}]};
}
test('bounded profile expressions honor negation, groups and explicit boolean operators',()=>{
  for(const expression of ['qa','!prod','qa & !prod','prod | qa','(prod | qa) & !blue','!(prod | blue)'])assert.equal(matchesProfile(expression,['qa']),true,expression);
  for(const expression of ['prod','!qa','qa & prod','!(qa | prod)'])assert.equal(matchesProfile(expression,['qa']),false,expression);
  for(const expression of ['', 'qa prod','qa & prod | blue','qa || prod','qa,prod','${profile}','qa &','(qa','qa)', '('.repeat(20)+'qa'+')'.repeat(20)])assert.throws(()=>matchesProfile(expression,['qa']),undefined,expression);
});
test('properties and YAML documents preserve order, activation and source locators',()=>{
  for(const [file,text] of [
    ['application.properties','peer.port=7000\n#---\nspring.config.activate.on-profile=qa & !prod\npeer.port=8100\n!---\nspring.config.activate.on-profile=prod\npeer.port=9999'],
    ['application.yaml','peer.port: 7000\n---\nspring.config.activate.on-profile: "qa & !prod"\npeer.port: 8100\n---\nspring.config.activate.on-profile: prod\npeer.port: 9999'],
  ]){
    const c=context(text,file),p=runAdapter('spring-properties/10',c);
    assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.port'],'8100');
    assert.deepEqual(c.ledger.facts.filter(f=>f.predicate==='configuration.document').map(f=>f.value.active),[true,true,false]);
    assert.equal(c.ledger.facts.find(f=>f.id===p.chains['peer.port'].at(-1)).value.locator,file+'#document=1');
    assert.equal(runAdapter('spring-properties/8',context(text,file)).complete,false);
  }
});
test('inactive imports and placeholders do not enter the effective configuration',()=>{
  const c=context('peer.port=7000\n#---\nspring.config.activate.on-profile=prod\nspring.config.import=missing.properties\npeer.port=${missing}');
  const p=runAdapter('spring-properties/10',c);assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.port'],'7000');
  assert.equal(c.ledger.facts.some(f=>f.predicate==='configuration.import'),false);
});
test('imports in active documents retain declaring-document identity',()=>{
  const c=context('peer.port=7000\n#---\nspring.config.activate.on-profile=qa\nspring.config.import=extra.properties');
  c.files.set('extra.properties','peer.port=8200');c.env.importBindings=[{from:'application.properties',location:'extra.properties',file:'extra.properties'}];c.env.profileBindings.push({from:'extra.properties',profile:'qa',file:null});
  const p=runAdapter('spring-properties/10',c);assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.port'],'8200');
  assert.equal(c.ledger.facts.find(f=>f.predicate==='configuration.import').value.document,1);
});
test('unsupported activation, ambiguous separators, malformed YAML and resource limits fail closed',()=>{
  for(const [file,text] of [
    ['app.properties','spring.config.activate.on-cloud-platform=kubernetes'],
    ['app.properties','spring.config.activate.on-profile=prod\nspring.profiles.include=qa'],
    ['app.properties','spring.config.activate.on-profile=qa | prod & blue'],
    ['app.properties','#comment\n#---\npeer.port=1'],
    ['app.properties','peer.port=1\n#---\n#comment'],
    ['app.properties','peer.port=1\\\n#---\npeer.port=2'],
    ['app.properties',Array(34).fill('peer.port=1').join('\n#---\n')],
    ['app.yaml','peer.port: 1\npeer.port: 2'],
    ['app.yaml','spring.config.activate.on-profile: [qa, prod]'],
    ['app.yaml','peer.port: 1\n---\ninvalid: ['],
  ])assert.equal(runAdapter('spring-properties/10',context(text,file)).complete,false,text);
  assert.throws(()=>parseConfigDocuments('app.yaml','a'.repeat(1024*1024+1),['qa']));
});
test('default-profile activation works with no active profiles',()=>{
  const c=context('peer.port=7000\n#---\nspring.config.activate.on-profile=default\npeer.port=8300');
  c.env.profiles=[];c.env.profileBindings[0].profile='default';c.resources[0].spec.template.spec.containers[0].env[0].value='';
  const p=runAdapter('spring-properties/10',c);assert.equal(p.complete,true);assert.equal(p.values['peer.port'],'8300');
});
test('v10 rejects incomplete active imports and does not silently consume inactive bindings',()=>{
  for(const active of [true,false]){
    const c=context(`peer.port=7000\n#---\nspring.config.activate.on-profile=${active?'qa':'prod'}\nspring.config.import=extra.properties`);
    if(!active)c.env.importBindings.push({from:'application.properties',location:'extra.properties',file:'extra.properties'});
    assert.equal(runAdapter('spring-properties/10',c).complete,false);
  }
});
test('v10 supports repository-only and mounted manifest forms',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-document-schema-'));
  try{
    const f=await createMountedConfigFixture(path.join(root,'inputs'),{documents:true});
    validateSystem(f.accepted);
    const c=f.accepted.environments[0].instances.find(i=>i.id==='portal').configuration;
    delete c.mountedFiles;delete c.mountedImportBindings;delete c.mountedProfileBindings;
    validateSystem(f.accepted);
    c.mountedFiles=['/config/app.properties'];assert.throws(()=>validateSystem(f.accepted));
  }finally{await rm(root,{recursive:true,force:true});}
});
let helm=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required');
test('v10 mounted documents retain pinned render evidence and deterministic edges',{skip:!helm},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-documents-'));
  try{
    const f=await createMountedConfigFixture(path.join(root,'inputs'),{documents:true});
    const first=await analyzeSystem(f.root,'accepted.json');
    const file=path.join(f.root,'deploy/values/qa/portal.yaml');await writeFile(file,(await readFile(file,'utf8')).replaceAll('sales-qa','dirty'));
    const again=await analyzeSystem(f.root,'accepted.json');assert.deepEqual(first.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const qa=first.snapshots.find(s=>s.environment==='qa');assert.equal(qa.dependencies.filter(d=>d.source==='portal'&&d.target==='orders').length,2);
    const docs=qa.facts.filter(f=>f.predicate==='configuration.document'&&f.value.from==='/etc/archi-config/leaf-qa.properties');
    assert.deepEqual(docs.map(f=>f.value.active),[true,true,false]);
    assert.ok(docs.every(f=>f.evidenceIds.some(id=>qa.evidence.find(e=>e.id===id)?.type==='helm_render')));
    assert.equal(first.snapshots.find(s=>s.environment==='production').dependencies.some(d=>d.source==='portal'),false);
    const c=f.accepted.environments[0].instances.find(i=>i.id==='portal').configuration;c.adapter='spring-properties/9';
    await writeFile(path.join(f.root,'legacy.json'),JSON.stringify(f.accepted));
    assert.equal((await analyzeSystem(f.root,'legacy.json')).snapshots[0].dependencies.some(d=>d.source==='portal'),false);
  }finally{await rm(root,{recursive:true,force:true});}
});
