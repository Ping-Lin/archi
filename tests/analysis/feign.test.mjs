import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger,hash} from '../../src/analysis/contract.mjs';
import {resolveCandidates,readObservations} from '../../src/analysis/resolve.mjs';
import {systemSchema} from '../../src/analysis/system-contract.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {createCrossRepoFixture} from '../../scripts/cross-repo-fixture.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';

const policy='explicit-registration-and-defaults-reviewed';
const client=`package example;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
@FeignClient(name="orders", url="\${downstream.url}")
public interface Orders {
  @GetMapping("/orders") String get();
}`;
const registration=`package example;
import org.springframework.context.annotation.Configuration;
import org.springframework.cloud.openfeign.EnableFeignClients;
@Configuration
@EnableFeignClients(clients={Orders.class})
public class Clients {}`;
function context(c=client,r=registration){
  return {files:new Map([['Orders.java',c],['Clients.java',r]]),source:{files:['Orders.java','Clients.java'],service:'portal'},env:{id:'qa',profiles:[],targets:[{id:'remote',kind:'external',url:'https://example.invalid'}]},ledger:createLedger('qa','portal'),service:{source:{registrationPolicy:policy}}};
}
function analyze(ctx=context(),values={'downstream.url':'https://example.invalid'}){
  const extracted=runAdapter('spring-feign/1',ctx),evidence=ctx.ledger.recordEvidence({type:'declared_analysis_scope',locator:'fixture'});
  const scopeFact=ctx.ledger.fact('properties.scope','portal',{},[evidence]),chains={};
  for(const [key,value] of Object.entries(values))chains[key]=[ctx.ledger.fact('property.value',key,{value},[evidence])];
  const resolved=resolveCandidates(extracted,{values,chains,scopeFact,complete:true},ctx.env,[],readObservations(null,ctx.env,ctx.ledger),ctx.ledger);
  return {...resolved,extracted,ledger:ctx.ledger};
}
test('explicit Feign registration resolves configured URL with both source citations',()=>{
  for(const ref of ['Orders.class','{Orders.class}','example.Orders.class']){
    const r=analyze(context(client,registration.replace('{Orders.class}',ref)));
    assert.equal(r.dependencies.length,1,JSON.stringify(r.extracted.diagnostics));
    assert.equal(r.candidates[0].name,'example.Orders');
    assert.equal(r.dependencies[0].endpointMeaning,'configured-base-url');
    const fact=r.ledger.facts.find(f=>f.predicate==='client.registration');
    assert.equal(fact.evidenceIds.length,3);
    assert.match(r.candidates[0].reasons.join(' '),/configuration activation/);
    assert.ok(r.ledger.resolutions[0].inputFactIds.includes(fact.id));
  }
});
test('explicit imports resolve across packages without simple-name guessing',()=>{
  const r=registration.replace('package example;','package config;\nimport example.Orders;');
  assert.equal(analyze(context(client,r)).dependencies.length,1);
  assert.equal(analyze(context(client,r.replace('import example.Orders;','import wrong.Orders;'))).dependencies.length,0);
  assert.equal(analyze(context(client,registration.replace('package example;','package config;'))).dependencies.length,0);
});
test('annotation attribute order and value alias are supported',()=>{
  for(const annotation of ['@FeignClient(url="${downstream.url}", name="orders")','@FeignClient(value="orders", url="${downstream.url}")']){
    assert.equal(analyze(context(client.replace('@FeignClient(name="orders", url="${downstream.url}")',annotation))).dependencies.length,1);
  }
});
test('multiple explicit clients remain separate candidates with shared configuration evidence',()=>{
  const c=context(client,registration.replace('Orders.class','Orders.class, Audit.class'));
  c.files.set('Audit.java',client.replace('name="orders"','name="audit"').replace('interface Orders','interface Audit'));
  c.source.files.push('Audit.java');
  const r=analyze(c);assert.equal(r.dependencies.length,2);
  assert.deepEqual(r.candidates.map(c=>c.name),['example.Orders','example.Audit']);
  assert.equal(new Set(r.dependencies.map(d=>d.candidateId)).size,2);
});
test('missing or oversized inputs and excessive source scopes fail before extraction',()=>{
  const missing=context();missing.files.delete('Orders.java');
  assert.throws(()=>analyze(missing),/input missing/);
  const large=context(' '.repeat(1024*1024+1));assert.throws(()=>analyze(large),/1 MiB/);
  const many=context();many.source.files=Array(65).fill('Orders.java');assert.throws(()=>analyze(many),/64 files/);
});
test('scanning, defaults, conditions, missing imports and nonempty registration stay unknown',()=>{
  for(const r of [
    registration.replace('(clients={Orders.class})',''),
    registration.replace('clients={Orders.class}','basePackages="example"'),
    registration.replace('clients={Orders.class}','clients={Orders.class}, defaultConfiguration=Other.class'),
    registration.replace('@Configuration','@Configuration @Profile("qa")'),
    registration.replace('class Clients {}','class Clients { void customize() {} }'),
    registration.replace('class Clients {}','class Clients extends Other {}'),
    registration.replace('org.springframework.cloud.openfeign.EnableFeignClients','wrong.EnableFeignClients'),
    registration.replace('Orders.class','Missing.class'),
    registration.replace('Orders.class','Orders.class, Orders.class'),
    'malformed Java',
  ])assert.equal(analyze(context(client,r)).dependencies.length,0,r);
});
test('name-only, custom-config, dynamic URL and inherited interfaces never create edges',()=>{
  for(const c of [
    client.replace(', url="${downstream.url}"',''),
    client.replace('name="orders"','name="${client.name}"'),
    client.replace('url="${downstream.url}"','url="${downstream.url}", configuration=Other.class'),
    client.replace('url="${downstream.url}"','url="${downstream.url}", contextId="other"'),
    client.replace('url="${downstream.url}"','url="https://literal.invalid"'),
    client.replace('${downstream.url}','${downstream.url:https://fallback.invalid}'),
    client.replace('interface Orders {','interface Orders extends Other {'),
    client.replace('interface Orders {','interface Orders<T> {'),
    client.replace('org.springframework.cloud.openfeign.FeignClient','wrong.FeignClient'),
    client.replace('import org.springframework.cloud.openfeign.FeignClient;','import org.springframework.cloud.openfeign.*;'),
    client.replace('@FeignClient','@Profile("qa") @FeignClient'),
  ])assert.equal(analyze(context(c)).dependencies.length,0,c);
});
test('source review and effective framework settings are required, HTTP-only and no missing-key fallback',()=>{
  const c=context();delete c.service.source.registrationPolicy;
  assert.equal(analyze(c).dependencies.length,0);
  for(const values of [{},{'downstream.url':'tcp://example.invalid:9000'},{'downstream.url':'orders'},{'downstream.url':'https://example.invalid','spring.cloud.openfeign.client.config.orders.url':'https://other.invalid'},{'downstream.url':'https://example.invalid','feign.client.config.default.contract':'Custom'}]){
    assert.equal(analyze(context(),values).dependencies.length,0);
  }
});
test('duplicates and unsupported selected files block scope independent of file order',()=>{
  for(const reverse of [false,true]){
    const c=context();c.files.set('Duplicate.java',client.replace('interface Orders','interface Other'));c.source.files.push('Duplicate.java');
    if(reverse)c.source.files.reverse();
    assert.equal(analyze(c).dependencies.length,0);
  }
  const c=context();c.files.set('Extra.java','class Extra {}');c.source.files.push('Extra.java');
  assert.equal(analyze(c).dependencies.length,0);
});
test('same input is deterministic, caller scopes remain isolated and schema requires review policy',()=>{
  assert.equal(hash(analyze().extracted),hash(analyze().extracted));
  const c=context();c.source.service='other';c.ledger=createLedger('qa','other');
  assert.notEqual(analyze().candidates[0].id,analyze(c).candidates[0].id);
  const validate=new Ajv().compile(systemSchema.properties.services.items.properties.source);
  const source={adapter:'spring-feign/1',files:[{repository:'app',path:'Orders.java'}],registrationPolicy:policy};
  assert.equal(validate(source),true,JSON.stringify(validate.errors));
  delete source.registrationPolicy;assert.equal(validate(source),false);
});

let helmAvailable=true;
try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helmAvailable=false;}
if(process.env.CI&&!helmAvailable)throw Error('CI requires Helm for Feign integration');
test('Feign composes with pinned configuration and scoped Helm evidence',{skip:!helmAvailable?'Helm unavailable; integration gate incomplete':false},async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'archi-feign-'));
  try{
    const f=await createCrossRepoFixture(path.join(temp,'inputs'));
    await writeFile(path.join(f.root,'portal','Clients.java'),registration);
    await writeFile(path.join(f.root,'portal','Orders.java'),client);
    const git=args=>execFileSync('git',['-C',path.join(f.root,'portal'),...args],{encoding:'utf8'}).trim();
    git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','Synthetic Feign inputs']);
    const revision=git(['rev-parse','HEAD']);f.manifest.repositories.find(r=>r.id==='portal').revision=revision;
    f.manifest.services.find(s=>s.id==='portal').source={adapter:'spring-feign/1',files:[{repository:'portal',path:'Clients.java'},{repository:'portal',path:'Orders.java'}],registrationPolicy:policy};
    await writeFile(f.path,JSON.stringify(f.manifest));
    const first=await analyzeSystem(f.root,'system.json');
    await writeFile(path.join(f.root,'portal','Orders.java'),'dirty invalid Java');
    const again=await analyzeSystem(f.root,'system.json');
    assert.deepEqual(first.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const qa=first.snapshots.find(s=>s.environment==='qa');
    const edge=qa.dependencies.find(d=>d.source==='portal'&&d.target==='orders');
    assert.ok(edge);assert.equal(edge.sourceAdapter,'spring-feign/1');
    const fact=qa.facts.find(f=>f.predicate==='client.registration');
    assert.ok(fact.evidenceIds.every(id=>qa.evidence.some(e=>e.id===id)));
    assert.equal(qa.evidence.filter(e=>fact.evidenceIds.includes(e.id)&&e.provenance?.revision===revision).length,2);
  }finally{await rm(temp,{recursive:true,force:true});}
});
