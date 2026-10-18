import test from 'node:test';
import assert from 'node:assert/strict';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger, hash} from '../../src/analysis/contract.mjs';
import {resolveCandidates, readObservations} from '../../src/analysis/resolve.mjs';
import {systemSchema} from '../../src/analysis/system-contract.mjs';
import Ajv from 'ajv';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {createCrossRepoFixture} from '../../scripts/cross-repo-fixture.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';

const imports={RestClient:'org.springframework.web.client.RestClient',WebClient:'org.springframework.web.reactive.function.client.WebClient'};
function specimen(type='RestClient',body=`return ${type}.create(url);`){
  return `import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import ${imports[type]};
@Configuration public class Clients {
  @Bean public ${type} peer(@Value("\${peer.url}") String url) { ${body} }
}`;
}
function extract(text,adapter='spring-http-factory/1',caller='portal'){
  const ledger=createLedger('qa',caller),env={id:'qa',profiles:['qa'],targets:[{id:'remote',kind:'external',url:'https://example.invalid'}]};
  const result=runAdapter(adapter,{files:new Map([['Clients.java',text]]),source:{service:caller,files:['Clients.java'],clientTypes:['RestClient','WebClient']},env,ledger});
  return {result,ledger,env};
}
function resolve(text,value='https://example.invalid',complete=true){
  const {result,ledger,env}=extract(text);
  const evidence=ledger.recordEvidence({type:'declared_analysis_scope',locator:'fixture'});
  const fact=ledger.fact('property.value','peer.url',{value},[evidence]);
  const properties={values:{'peer.url':value},chains:{'peer.url':[fact]},scopeFact:fact,complete};
  return resolveCandidates(result,properties,env,[],readObservations(null,env,ledger),ledger);
}
test('HTTP factories opt in to explicit imports and preserve base-URL evidence',()=>{
  for(const type of Object.keys(imports))for(const expr of [`${type}.create(url)`,`${type}.builder().baseUrl(url).build()`]){
    const text=specimen(type,`return ${expr};`),{result,ledger}=extract(text);
    assert.equal(result.candidates.length,1);assert.deepEqual(result.candidates[0].unsupported,[]);
    assert.equal(result.candidates[0].key,'peer.url');
    assert.equal(ledger.facts[0].value.endpointMeaning,'configured-base-url');
    assert.equal(ledger.evidence[1].parentEvidenceId,ledger.evidence[0].id);
    assert.ok(extract(text,'spring-explicit-bean/1').result.candidates[0].unsupported.length);
    assert.equal(resolve(text).dependencies.length,1);
    assert.match(resolve(text).candidates[0].reasons.join(' '),/request URI overrides/);
  }
});
test('unsupported factory bodies and registration never produce an edge',()=>{
  const base=specimen();
  const cases=[
    specimen('RestClient','return RestClient.builder().baseUrl(url).defaultHeader("X", "Y").build();'),
    specimen('RestClient','return RestClient.create(url + "/other");'),
    specimen('RestClient','url = "https://wrong.invalid"; return RestClient.create(url);'),
    specimen('RestClient','return builder.baseUrl(url).build();'),
    specimen('RestClient','return new RestClient(url);'),
    base.replace(imports.RestClient,'example.RestClient'),
    base.replace(`import ${imports.RestClient};`,'import org.springframework.web.client.*;'),
    base.replace('@Bean ',''),base.replace('@Bean ','@Bean("alias") '),
    base.replace('String url','String RestClient').replace('.create(url)','.create(RestClient)'),
    base.replace('public class Clients {','public class Clients { Object RestClient;'),
    base.replace('public class Clients {','public class Clients<RestClient> {'),
    base.replace('public RestClient peer','public <RestClient> RestClient peer'),
    base.replace('@Configuration','import static example.Other.RestClient;\n@Configuration'),
    base.replace('public class Clients {','public class Clients { interface RestClient {}'),
    base.replace('public class Clients {','public class Clients extends Other {'),
    base.replace('String url','String url, RestClient.Builder builder'),
  ];
  for(const text of cases){
    const {result}=extract(text);assert.ok(result.diagnostics.length,text);
    assert.equal(resolve(text).dependencies.length,0,text);
  }
});
test('HTTP base URLs cannot resolve TCP, missing values or incomplete configuration',()=>{
  for(const value of ['tcp://example.invalid:8080','/relative','${missing}',undefined]){
    const r=resolve(specimen(),value===undefined?null:value);
    assert.equal(r.dependencies.length,0);assert.equal(r.candidates[0].eligibility,'unknown');
  }
  assert.equal(resolve(specimen(),'https://example.invalid',false).dependencies.length,0);
});
test('conditions, duplicate beans and malformed source remain conservative',()=>{
  assert.equal(resolve(specimen().replace('@Bean','@Bean @Profile("prod")')).candidates[0].eligibility,'disabled');
  const text=specimen(),method=text.slice(text.indexOf('  @Bean'),text.lastIndexOf('}'));
  assert.equal(resolve(text.slice(0,text.lastIndexOf('}'))+method+'}').dependencies.length,0);
  assert.equal(extract('class {').result.coverage.status,'partial');
});
test('same inputs are deterministic and caller identity remains isolated',()=>{
  const a=extract(specimen()),b=extract(specimen()),c=extract(specimen(),'spring-http-factory/1','other');
  assert.equal(hash(a.result),hash(b.result));assert.equal(hash(a.ledger.facts),hash(b.ledger.facts));
  assert.notEqual(a.result.candidates[0].id,c.result.candidates[0].id);
});
test('system source schema accepts the versioned adapter without changing legacy mode',()=>{
  const validate=new Ajv().compile(systemSchema.properties.services.items.properties.source);
  const source={adapter:'spring-http-factory/1',files:[{repository:'app',path:'Clients.java'}],clientTypes:['RestClient']};
  assert.equal(validate(source),true,JSON.stringify(validate.errors));
  assert.equal(validate({...source,adapter:'spring-http-factory/2'}),false);
  assert.equal(validate({...source,adapter:'spring-explicit-bean/1'}),true);
});
test('legacy constructor adapter enforces its documented inheritance restriction',()=>{
  const base=specimen('RestClient','return new RestClient(url);');
  assert.deepEqual(extract(base,'spring-explicit-bean/1').result.candidates[0].unsupported,[]);
  for(const clause of ['extends Other','implements Other']){
    const r=extract(base.replace('class Clients {',`class Clients ${clause} {`),'spring-explicit-bean/1').result;
    assert.ok(r.candidates[0].unsupported.length);
  }
});
let helmAvailable=true;
try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helmAvailable=false;}
if(process.env.CI&&!helmAvailable)throw Error('CI requires Helm for HTTP factory integration');
test('pinned HTTP factories compose with Helm and retain provenance and deterministic hashes',{skip:!helmAvailable?'Helm unavailable; integration gate incomplete':false},async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'archi-http-factory-'));
  try{
    const f=await createCrossRepoFixture(path.join(temp,'inputs'));
    const file=path.join(f.root,'portal','Clients.java');
    const original=await readFile(file,'utf8');
    await writeFile(file,original.replace('package example;','package example;\nimport org.springframework.web.client.RestClient;').replaceAll('RemoteClient','RestClient').replaceAll('new RestClient(url)','RestClient.builder().baseUrl(url).build()'));
    const git=args=>execFileSync('git',['-C',path.join(f.root,'portal'),...args],{encoding:'utf8'}).trim();
    git(['add','Clients.java']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','Synthetic HTTP factories']);
    const revision=git(['rev-parse','HEAD']);f.manifest.repositories.find(r=>r.id==='portal').revision=revision;
    const source=f.manifest.services.find(s=>s.id==='portal').source;source.adapter='spring-http-factory/1';source.clientTypes=['RestClient'];
    await writeFile(f.path,JSON.stringify(f.manifest));
    const first=await analyzeSystem(f.root,'system.json');
    await writeFile(file,'dirty invalid Java must not be read');
    const second=await analyzeSystem(f.root,'system.json');
    assert.deepEqual(first.snapshots.map(s=>s.contentHash),second.snapshots.map(s=>s.contentHash));
    const qa=first.snapshots.find(s=>s.environment==='qa');
    const edge=qa.dependencies.find(d=>d.source==='portal'&&d.target==='orders');
    assert.ok(edge);assert.equal(edge.endpointMeaning,'configured-base-url');
    assert.ok(qa.evidence.some(e=>e.provenance?.revision===revision));
    source.adapter='spring-explicit-bean/1';await writeFile(f.path,JSON.stringify(f.manifest));
    const old=await analyzeSystem(f.root,'system.json');
    assert.equal(old.snapshots[0].dependencies.some(d=>d.source==='portal'),false);
  }finally{await rm(temp,{recursive:true,force:true});}
});
