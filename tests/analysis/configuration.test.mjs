import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {parseProperties,parsePropertyFile,flattenProperties} from '../../src/analysis/property-files.mjs';
import {resolveEndpointBinding} from '../../src/analysis/endpoint-binding.mjs';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';
import {createConfigurationFixture} from '../../scripts/configuration-fixture.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';
import {validateSystem} from '../../src/analysis/system-contract.mjs';
import {captureSystem} from '../../src/analysis/repositories.mjs';
import {verifyAiBundle,candidateHash} from '../../src/analysis/ai-candidates.mjs';
let helm=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required');

test('properties syntax preserves escapes, continuation, separators, empty values and safe keys',()=>{
  const p=parseProperties('# comment\r\n! other\nfirst:value\nsecond = spaced  \nempty\na\\ b:yes\nunicode=\\u0041\njoined=one\\\n  two\n__proto__=literal\nslash=two\\\\\n');
  assert.equal(p.first,'value');assert.equal(p.second,'spaced  ');assert.equal(p.empty,'');
  assert.equal(p['a b'],'yes');assert.equal(p.unicode,'A');assert.equal(p.joined,'onetwo');assert.equal(p.slash,'two\\');assert.equal(p.__proto__,'literal');
  for(const invalid of ['a=1\na=2','a=\\uXYZZ','a=\\uu0041','a=1\n#---\na=2','a=中文','a=foo\\'])assert.throws(()=>parseProperties(invalid));
  assert.throws(()=>parsePropertyFile('x.yaml','a: 1\n---\nb: 2'));
  assert.throws(()=>flattenProperties({'a.b':1,a:{b:2}}));
});

const propertiesContext=()=>({files:new Map([['app.properties','peer.port=7000\npeer.host=orders\n'],['qa.yaml','peer.port: 8000\n']]),
  env:{id:'qa',profiles:['qa'],propertiesComplete:true,propertyFiles:['app.properties','qa.yaml'],environmentBindings:[{name:'PEER_PORT',key:'peer.port'}]},
  source:{service:'portal'},ledger:createLedger('qa','portal'),resources:[{kind:'Deployment',key:'workload',service:'portal',spec:{template:{spec:{containers:[{env:[
    {name:'SPRING_APPLICATION_JSON',value:'{"peer.port":8080}'},{name:'PEER_PORT',value:'9000'},{name:'SPRING_PROFILES_ACTIVE',value:'qa'},
  ]}]}}}}]});
test('configuration v2 resolves files then explicitly mapped env then JSON, preserving every value fact',()=>{
  const c=propertiesContext(),p=runAdapter('spring-properties/2',c);
  assert.equal(p.complete,true);assert.equal(p.values['peer.port'],'8080');
  assert.deepEqual(p.chains['peer.port'].map(id=>c.ledger.facts.find(f=>f.id===id).value.value),['7000','8000','9000','8080']);
  assert.equal(runAdapter('spring-properties/1',{...c,ledger:createLedger('qa','portal')}).complete,false);
});
test('missing overrides and unsupported configuration semantics stay incomplete',()=>{
  const edits=[
    c=>c.files.set('app.properties','peer.host=${HOST:orders}'),
    c=>c.files.set('app.properties','spring.config.import=other.properties'),
    c=>c.resources[0].spec.template.spec.containers[0].env.splice(1,1),
    c=>c.resources[0].spec.template.spec.containers[0].env.push({name:'OTHER_CONFIG',value:'x'}),
    c=>c.resources[0].spec.template.spec.containers[0].env[1].valueFrom={secretKeyRef:{name:'secret',key:'port'}},
    c=>c.resources[0].spec.template.spec.containers[0].envFrom=[{configMapRef:{name:'other'}}],
    c=>c.env.propertiesComplete=false,
  ];
  for(const edit of edits){const c=propertiesContext();edit(c);assert.equal(runAdapter('spring-properties/2',c).complete,false);}
});
test('endpoint binding uses arbitrary keys without unsafe composition or protocol guessing',()=>{
  const binding={kind:'host-port',hostKey:'custom.host',portKey:'custom.port'},v={'custom.host':'orders','custom.port':'8080'};
  assert.equal(resolveEndpointBinding(binding,'HTTP',v),'http://orders:8080');
  assert.equal(resolveEndpointBinding({kind:'url-key',key:'other'},'HTTPS',{other:'https://orders/path'}),'https://orders/path');
  for(const host of ['http://orders','orders/path','orders@other','orders?x','orders#x',' orders','[::1]'])assert.equal(resolveEndpointBinding(binding,'HTTP',{...v,'custom.host':host}),null);
  for(const port of ['','-1','65536','8080/x','1e3'])assert.equal(resolveEndpointBinding(binding,'HTTP',{...v,'custom.port':port}),null);
  assert.equal(resolveEndpointBinding(binding,'gRPC',v),null);
  assert.equal(resolveEndpointBinding({kind:'url-key',key:'x'},'HTTP',{x:'https://orders'}),null);
});
test('v2 contracts bind endpoint shape to evidence review and reject version mixing',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-config-contract-'));
  try {
    const f=await createConfigurationFixture(path.join(root,'input')),inputs=await captureSystem(f.root,'system.json');
    const service=f.manifest.services.find(s=>s.id==='portal');
    verifyAiBundle(f.bundle,{...inputs,service,simulation:true});
    const changed=structuredClone(f.bundle.candidates[0]);changed.endpoint.portKey='other';
    assert.notEqual(candidateHash(f.bundle,changed),candidateHash(f.bundle,f.bundle.candidates[0]));
    assert.throws(()=>verifyAiBundle({...f.bundle,schemaVersion:'archi/ai-candidates-v1alpha1'},{...inputs,service,simulation:true}));
    for(const mappings of [[{name:'PEER_PORT',key:'x'},{name:'PEER_PORT',key:'y'}],[{name:'SPRING_CONFIG_IMPORT',key:'x'}]]) {
      const m=structuredClone(f.manifest);m.environments[0].instances[0].configuration.environmentBindings=mappings;
      assert.throws(()=>validateSystem(m));
    }
    const out=path.join(root,'template.json');
    execFileSync(process.execPath,['scripts/ai-candidates.mjs','template','--root',f.root,'--system','system.json','--service','portal','--out',out]);
    const {readFile}=await import('node:fs/promises');assert.equal(JSON.parse(await readFile(out,'utf8')).schemaVersion,'archi/ai-candidates-v1alpha2');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('real Helm composition supports different project keys and keeps review scopes isolated', {skip:!helm},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-config-e2e-'));
  try {
    const f=await createConfigurationFixture(path.join(root,'input'));
    const result=await analyzeSystem(f.root,'accepted.json'),qa=result.snapshots.find(s=>s.environment==='qa'),prod=result.snapshots.find(s=>s.environment==='production');
    assert.equal(qa.dependencies.find(d=>d.source==='portal').target,'orders');
    assert.equal(qa.dependencies.find(d=>d.source==='orders').target,'inventory');
    assert.equal(prod.dependencies.some(d=>d.source==='portal'),false);
    const c=qa.candidates.find(c=>c.source==='portal'),resolution=qa.resolutions.find(r=>r.id===c.resolutionId);
    const facts=qa.facts.filter(f=>resolution.inputFactIds.includes(f.id));
    assert.deepEqual(facts.filter(f=>f.predicate==='property.value'&&f.subject==='gateway.peer.port').map(f=>f.value.value),['7000','8000','9000','8080']);
    assert.ok(facts.some(f=>f.predicate==='endpoint.binding'));
    const again=await analyzeSystem(f.root,'accepted.json');assert.deepEqual(result.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const bad=structuredClone(f.accepted);bad.environments[0].instances[0].configuration.environmentBindings=[];
    await writeFile(path.join(f.root,'incomplete.json'),JSON.stringify(bad));
    assert.equal((await analyzeSystem(f.root,'incomplete.json')).snapshots[0].dependencies.some(d=>d.source==='portal'),false);
  }finally{await rm(root,{recursive:true,force:true});}
});
