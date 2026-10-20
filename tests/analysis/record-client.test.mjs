import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import Ajv from 'ajv';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger,hash} from '../../src/analysis/contract.mjs';
import {resolveCandidates,readObservations} from '../../src/analysis/resolve.mjs';
import {systemSchema} from '../../src/analysis/system-contract.mjs';
import {createCrossRepoFixture} from '../../scripts/cross-repo-fixture.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';

const record=await readFile(new URL('../../examples/record-client/Peer.java',import.meta.url),'utf8');
const factory=await readFile(new URL('../../examples/record-client/Clients.java',import.meta.url),'utf8');
const policy='explicit-record-binding-reviewed';
function context(r=record,f=factory){
  return {files:new Map([['Peer.java',r],['Clients.java',f]]),source:{service:'portal',files:['Peer.java','Clients.java']},env:{id:'qa',profiles:[],targets:[{id:'orders',kind:'external',url:'https://orders.example.invalid'}]},ledger:createLedger('qa','portal'),service:{source:{bindingPolicy:policy}}};
}
function analyze(c=context(),values={'peer.base-url':'https://orders.example.invalid'},complete=true){
  const extracted=runAdapter('spring-record-client/1',c);
  const evidence=c.ledger.recordEvidence({type:'declared_analysis_scope',locator:'test'});
  const scopeFact=c.ledger.fact('properties.scope','portal',{},[evidence]),chains={};
  for(const [key,value] of Object.entries(values))chains[key]=[c.ledger.fact('property.value',key,{value},[evidence])];
  return {...resolveCandidates(extracted,{values,chains,scopeFact,complete},c.env,[],readObservations(null,c.env,c.ledger),c.ledger),extracted,ledger:c.ledger};
}
test('registered String record accessor resolves canonical key with both source files in evidence',()=>{
  const result=analyze();assert.equal(result.dependencies.length,1,JSON.stringify(result.extracted.diagnostics));
  assert.equal(result.candidates[0].key,'peer.base-url');
  const fact=result.ledger.facts.find(f=>f.predicate==='configuration.binding');
  assert.equal(fact.value.type,'example.Peer');assert.equal(fact.value.member,'baseUrl');
  assert.equal(fact.evidenceIds.length,3);
  assert.ok(result.ledger.resolutions[0].inputFactIds.includes(fact.id));
  assert.equal(result.ledger.resolutions[0].version,'spring-record-client/1');
  assert.equal(result.dependencies[0].endpointMeaning,'configured-base-url');
});
test('both HTTP client factory forms and prefix annotation aliases are supported',()=>{
  for(const type of ['RestClient','WebClient'])for(const form of ['create(peer.baseUrl())','builder().baseUrl(peer.baseUrl()).build()']){
    const f=factory.replace('org.springframework.web.client.RestClient',type==='WebClient'?'org.springframework.web.reactive.function.client.WebClient':'org.springframework.web.client.RestClient').replaceAll('RestClient',type).replace(`${type}.builder().baseUrl(peer.baseUrl()).build()`,`${type}.${form}`);
    for(const prefix of ['prefix = "peer"','value = "peer"','"peer"'])assert.equal(analyze(context(record.replace('prefix = "peer"',prefix),f)).dependencies.length,1);
  }
});
test('fully qualified types and explicit imports preserve package identity',()=>{
  const f=factory.replace('package example;','package config;\nimport example.Peer;');
  assert.equal(analyze(context(record,f)).dependencies.length,1);
  assert.equal(analyze(context(record,f.replace('import example.Peer;','import other.Peer;'))).dependencies.length,0);
  const fully=factory.replace('package example;','package config;').replaceAll('Peer.class','example.Peer.class').replace('downstream(Peer peer)','downstream(example.Peer peer)');
  assert.equal(analyze(context(record,fully)).dependencies.length,1);
});
test('multiple flat String components work without requiring unused values',()=>{
  const r=record.replace('String baseUrl','String baseUrl, String label');
  assert.equal(analyze(context(r)).dependencies.length,1);
});
test('custom record semantics, scanning and mutable beans remain unsupported',()=>{
  for(const r of [
    record.replace('String baseUrl','java.net.URI baseUrl'),
    record.replace('String baseUrl','@DefaultValue("https://fallback.invalid") String baseUrl'),
    record.replace('{}','{ public String baseUrl() { return "https://wrong.invalid"; } }'),
    record.replace('{}','{ public Peer { baseUrl = "https://wrong.invalid"; } }'),
    record.replace('record Peer(String baseUrl) {}','class Peer { public String baseUrl() { return "https://wrong.invalid"; } }'),
    record.replace('prefix = "peer"','prefix = "Peer"'),
    record.replace('prefix = "peer"','prefix = "${prefix}"'),
    record.replace('@ConfigurationProperties','@Component @ConfigurationProperties'),
    record.replace('org.springframework.boot.context.properties.ConfigurationProperties','wrong.ConfigurationProperties'),
  ])assert.equal(analyze(context(r)).dependencies.length,0,r);
});
test('registration, accessor, factory and conversion scope must be explicit',()=>{
  for(const f of [
    factory.replace('@EnableConfigurationProperties(Peer.class)',''),
    factory.replace('@EnableConfigurationProperties(Peer.class)','@ConfigurationPropertiesScan'),
    factory.replace('Peer.class','Other.class'),
    factory.replace('Peer.class','{Peer.class, Peer.class}'),
    factory.replace('peer.baseUrl()','peer.other()'),
    factory.replace('peer.baseUrl()','peer.baseUrl() + "/other"'),
    factory.replace('@Bean','@Bean @Profile("qa")'),
    factory.replace('public class Clients {','public class Clients extends Other {'),
    factory.replace('public class Clients {','public class Clients { Object RestClient;'),
    factory.replace('return RestClient','peer = new Peer("https://wrong.invalid"); return RestClient'),
    factory.replace('org.springframework.web.client.RestClient','wrong.RestClient'),
    factory.replace('public class Clients {','public class Clients { @Bean String conversionService() { return "custom"; }'),
  ])assert.equal(analyze(context(record,f)).dependencies.length,0,f);
  const c=context();delete c.service.source.bindingPolicy;assert.equal(analyze(c).dependencies.length,0);
});
test('relaxed aliases, missing values, unsupported protocols and incomplete config cannot create edges',()=>{
  for(const values of [
    {},{'peer.baseUrl':'https://orders.example.invalid'},
    {'peer.base-url':'https://orders.example.invalid','peer.baseUrl':'https://wrong.invalid'},
    {'PEER_BASEURL':'https://orders.example.invalid'},
    {'peer.base-url':'tcp://orders.example.invalid:9000'},
  ])assert.equal(analyze(context(),values).dependencies.length,0);
  assert.equal(analyze(context(),{'peer.base-url':'https://orders.example.invalid'},false).dependencies.length,0);
});
test('duplicates, malformed and oversized input fail closed with deterministic caller isolation',()=>{
  const c=context();c.files.set('Duplicate.java',record);c.source.files.push('Duplicate.java');assert.equal(analyze(c).dependencies.length,0);
  assert.equal(analyze(context('malformed Java')).dependencies.length,0);
  assert.throws(()=>analyze(context(' '.repeat(1024*1024+1))),/1 MiB/);
  assert.equal(hash(analyze().extracted),hash(analyze().extracted));
  const other=context();other.source.service='other';other.ledger=createLedger('qa','other');
  assert.notEqual(analyze().candidates[0].id,analyze(other).candidates[0].id);
});
test('manifest source requires explicit record binding policy',()=>{
  const validate=new Ajv().compile(systemSchema.properties.services.items.properties.source);
  const source={adapter:'spring-record-client/1',files:[{repository:'portal',path:'Peer.java'}],bindingPolicy:policy};
  assert.equal(validate(source),true,JSON.stringify(validate.errors));
  delete source.bindingPolicy;assert.equal(validate(source),false);
});

let helmAvailable=true;
try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helmAvailable=false;}
if(process.env.CI&&!helmAvailable)throw Error('CI requires Helm for record binding integration');
test('record source, properties and Helm compose from pinned inputs',{skip:!helmAvailable?'Helm unavailable; integration gate incomplete':false},async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'archi-record-'));
  try{
    const f=await createCrossRepoFixture(path.join(temp,'inputs'));
    await writeFile(path.join(f.root,'portal','Clients.java'),factory);
    await writeFile(path.join(f.root,'portal','Peer.java'),record);
    await writeFile(path.join(f.root,'portal','application.properties'),'peer.base-url=${downstream.url}\n');
    const git=args=>execFileSync('git',['-C',path.join(f.root,'portal'),...args],{encoding:'utf8'}).trim();
    git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','Synthetic record clients']);
    const revision=git(['rev-parse','HEAD']);f.manifest.repositories.find(r=>r.id==='portal').revision=revision;
    f.manifest.services.find(s=>s.id==='portal').source={adapter:'spring-record-client/1',files:[{repository:'portal',path:'Clients.java'},{repository:'portal',path:'Peer.java'}],bindingPolicy:policy};
    for(const env of f.manifest.environments){const instance=env.instances.find(i=>i.service==='portal');instance.propertyFiles=[{repository:'portal',path:'application.properties'}];instance.configuration={adapter:'spring-properties/3',environmentBindings:[]};}
    await writeFile(f.path,JSON.stringify(f.manifest));
    const first=await analyzeSystem(f.root,'system.json');
    await writeFile(path.join(f.root,'portal','Peer.java'),'dirty invalid Java');
    const again=await analyzeSystem(f.root,'system.json');
    assert.deepEqual(first.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const qa=first.snapshots.find(s=>s.environment==='qa');
    const edge=qa.dependencies.find(d=>d.source==='portal'&&d.target==='orders');
    assert.ok(edge,JSON.stringify(qa.candidates.filter(c=>c.source==='portal')));assert.equal(edge.sourceAdapter,'spring-record-client/1');
    const fact=qa.facts.find(f=>f.predicate==='configuration.binding');
    assert.equal(qa.evidence.filter(e=>fact.evidenceIds.includes(e.id)&&e.provenance?.revision===revision).length,2);
  }finally{await rm(temp,{recursive:true,force:true});}
});
