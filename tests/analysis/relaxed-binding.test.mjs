import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger,hash} from '../../src/analysis/contract.mjs';
import {resolveCandidates,readObservations} from '../../src/analysis/resolve.mjs';
import {systemSchema} from '../../src/analysis/system-contract.mjs';
import {selectRelaxedProperty} from '../../src/analysis/relaxed-binding.mjs';
const url='https://orders.example.invalid';
const examples={};
for(const kind of ['record','bean'])examples[kind]=new Map(await Promise.all(['Peer.java','Clients.java'].map(async name=>[name,await readFile(new URL(`../../examples/${kind}-client/${name}`,import.meta.url),'utf8')])));
function analyze(kind,values,version=2,complete=true){
  const ledger=createLedger('qa','portal'),env={id:'qa',profiles:[],targets:[{id:'orders',kind:'external',url}]};
  const extracted=runAdapter(`spring-${kind}-client/${version}`,{files:examples[kind],source:{service:'portal',files:[...examples[kind].keys()]},env,ledger,service:{source:{bindingPolicy:`explicit-${kind}-binding-reviewed`}}});
  const evidence=ledger.recordEvidence({type:'declared_analysis_scope',locator:'synthetic-properties'});
  const scopeFact=ledger.fact('properties.scope','portal',{},[evidence]),chains={};
  for(const [key,value] of Object.entries(values))chains[key]=[ledger.fact('property.value',key,{value},[evidence])];
  return {...resolveCandidates(extracted,{values,chains,scopeFact,complete},env,[],readObservations(null,env,ledger),ledger),ledger};
}
test('v2 binds unique canonical, camelCase and underscore keys for records and beans with evidence',()=>{
  for(const kind of ['record','bean'])for(const key of ['peer.base-url','peer.baseUrl','peer.base_url']){
    const result=analyze(kind,{[key]:url});
    assert.equal(result.dependencies.length,1);
    assert.equal(result.candidates[0].key,'peer.base-url');
    assert.equal(result.candidates[0].value,url);
    const fact=result.ledger.facts.find(f=>f.predicate==='configuration.property-binding');
    assert.equal(fact.value.selectedKey,key);
    assert.deepEqual(fact.value.consideredKeys,[key]);
    assert.ok(result.ledger.resolutions[0].inputFactIds.includes(fact.id));
    const property=result.ledger.facts.find(f=>f.predicate==='property.value');
    assert.ok(result.ledger.resolutions[0].inputFactIds.includes(property.id));
    assert.equal(result.ledger.resolutions[0].version,`spring-${kind}-client/2`);
  }
});
test('v1 remains canonical-only and v2 conflicts never choose map order',()=>{
  for(const kind of ['record','bean']){
    assert.equal(analyze(kind,{'peer.baseUrl':url},1).dependencies.length,0);
    for(const values of [
      {'peer.base-url':url,'peer.baseUrl':'https://other.invalid'},
      {'peer.baseUrl':url,'peer.base-url':'https://other.invalid'},
      {'peer.base-url':url,'peer.base_url':url},
      {'peer.base_url':url,'peer.baseUrl':url},
    ])assert.equal(analyze(kind,values).dependencies.length,0);
  }
});
test('unsupported spelling, missing data, incomplete scope and invalid URL stay unknown',()=>{
  for(const kind of ['record','bean']){
    for(const values of [{},{null:url},{'PEER_BASEURL':url},{'peer.baseurl':url},{'peer.base.url':url},{'peer.base/url':url},{'Peer.baseUrl':url},{'peer.baseUrl':'tcp://orders:9000'},{'peer.baseUrl':url,'peer.base!url':url}])assert.equal(analyze(kind,values).dependencies.length,0);
    assert.equal(analyze(kind,{'peer.baseUrl':url},2,false).dependencies.length,0);
  }
});
test('unused member collisions block scope and prefix aliases are not inferred',()=>{
  const c={key:'peer.base-url',bindingKeys:['peer.base-url','peer.other-name']};
  assert.ok(selectRelaxedProperty(c,{'peer.baseUrl':url,'peer.other-name':'a','peer.otherName':'b'}).unsupported.length);
  const ambiguous={key:'peer.base-url',bindingKeys:['peer.base-url','peer.baseurl']};
  assert.ok(selectRelaxedProperty(ambiguous,{'peer.baseUrl':url}).unsupported.length);
  const prefixed={key:'my-peer.base-url',bindingKeys:['my-peer.base-url']};
  assert.equal(selectRelaxedProperty(prefixed,{'my-peer.baseUrl':url}).selectedKey,'my-peer.baseUrl');
  assert.equal(selectRelaxedProperty(prefixed,{'myPeer.baseUrl':url}).selectedKey,null);
});
test('selection is deterministic and leaves effective properties untouched',()=>{
  const values=Object.freeze({'peer.baseUrl':url,'unrelated':'value'}),before=hash(values);
  assert.equal(hash(analyze('bean',values)),hash(analyze('bean',values)));
  assert.equal(hash(values),before);
});
test('both v2 manifest adapters retain explicit review policy',()=>{
  const validate=new Ajv().compile(systemSchema.properties.services.items.properties.source);
  for(const kind of ['bean','record']){
    const source={adapter:`spring-${kind}-client/2`,files:[{repository:'portal',path:'Peer.java'}],bindingPolicy:`explicit-${kind}-binding-reviewed`};
    assert.equal(validate(source),true);
    delete source.bindingPolicy;assert.equal(validate(source),false);
  }
});
