import test from 'node:test';
import assert from 'node:assert/strict';
import {stringify} from 'yaml';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';
import {parseManifest,redactSecretManifests} from '../../src/analysis/helm.mjs';
import {createConfigMapFixture} from '../../scripts/configmap-fixture.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';
import {writeAnalysis} from '../../src/analysis/run.mjs';

function context(edit=()=>{}) {
  const env={id:'qa',cluster:'cluster',namespace:'app',profiles:['qa'],propertiesComplete:true,propertyFiles:['app.properties'],environmentBindings:[{name:'PORT',key:'peer.port'}]};
  const container={envFrom:[{configMapRef:{name:'defaults'}},{configMapRef:{name:'override'}}],env:[
    {name:'PORT',valueFrom:{configMapKeyRef:{name:'explicit',key:'port'}}},
    {name:'SPRING_PROFILES_ACTIVE',value:'qa'},
    {name:'SPRING_APPLICATION_JSON',value:'{"peer.port":"9090"}'},
  ]};
  const docs=[{apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'app',labels:{'app.kubernetes.io/name':'portal'}},spec:{template:{spec:{containers:[container]}}}},
    ...[['defaults',{PORT:'7000'}],['override',{PORT:'8000'}],['explicit',{port:'8080'}]].map(([name,data])=>({apiVersion:'v1',kind:'ConfigMap',metadata:{name},data}))];
  edit({container,docs,env});
  const ledger=createLedger('qa','portal'),{resources}=parseManifest(docs.map(d=>stringify(d)).join('---\n'),env,ledger);
  return {files:new Map([['app.properties','peer.port=6000']]),env,source:{service:'portal'},resources,ledger};
}
test('v4 preserves configuration precedence and scoped reference evidence',()=>{
  const c=context(),p=runAdapter('spring-properties/4',c);
  assert.equal(p.complete,true);assert.equal(p.values['peer.port'],'9090');
  assert.deepEqual(p.chains['peer.port'].map(id=>c.ledger.facts.find(f=>f.id===id).value.value),['6000','8080','9090']);
  assert.equal(p.referenceFactIds.length,3);
  for(const id of p.referenceFactIds)assert.ok(c.ledger.facts.find(f=>f.id===id).evidenceIds.length);
  assert.equal(runAdapter('spring-properties/3',context()).complete,false);
  const last=context(({container})=>{container.env=container.env.filter(e=>e.name!=='PORT'&&e.name!=='SPRING_APPLICATION_JSON');});
  assert.equal(runAdapter('spring-properties/4',last).values['peer.port'],'8000','later envFrom wins');
  const explicit=context(({container})=>{container.env=container.env.filter(e=>e.name!=='SPRING_APPLICATION_JSON');});
  assert.equal(runAdapter('spring-properties/4',explicit).values['peer.port'],'8080','explicit env wins over envFrom');
});
test('v4 fails closed on missing, malformed, foreign-scope and opaque inputs',()=>{
  const edits=[
    ({docs})=>docs.splice(3,1),
    ({docs})=>docs[3].metadata.namespace='another',
    ({docs})=>docs[3].data.port=8080,
    ({container})=>container.env[0].valueFrom.configMapKeyRef.key='missing',
    ({container})=>delete container.env[0].valueFrom.configMapKeyRef.key,
    ({container})=>container.env[0].valueFrom={secretKeyRef:{name:'secret',key:'port'}},
    ({container})=>container.envFrom=[{secretRef:{name:'secret',optional:true}}],
    ({container})=>container.envFrom=[{configMapRef:{name:'missing',optional:true}}],
    ({container})=>container.env[0].value='1234',
    ({container})=>container.env[0].valueFrom={fieldRef:{fieldPath:'metadata.name'}},
    ({container})=>container.env.push({...container.env[0]}),
    ({container})=>container.envFrom=[{configMapRef:{name:'defaults'},secretRef:{name:'secret'}}],
    ({docs})=>docs[1].data.OTHER='unmapped',
    ({docs})=>docs[1].data['bad.key']='unsupported-env-name',
    ({container})=>container.volumeMounts=[{name:'config',mountPath:'/app'}],
    ({env})=>env.propertiesComplete=false,
  ];
  for(const edit of edits)assert.equal(runAdapter('spring-properties/4',context(edit)).complete,false,edit.toString());
  const c=context();c.resources.find(r=>r.name==='explicit').key='another||configmaps|app|explicit';
  assert.equal(runAdapter('spring-properties/4',c).complete,false);
});
test('standard Secret exports remove values and metadata payloads, including Lists',()=>{
  const secret={apiVersion:'v1',kind:'Secret',metadata:{name:'credential',annotations:{note:'sensitive-marker'}},data:{password:'c2Vuc2l0aXZl'},stringData:{password:'sensitive-marker'}};
  for(const doc of [secret,{apiVersion:'v1',kind:'List',items:[secret]}]) {
    const result=redactSecretManifests(stringify(doc));
    assert.doesNotMatch(result,/sensitive-marker|c2Vuc2l0aXZl|password/);assert.match(result,/archi.redacted: true/);
  }
  const ordinary='apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app\ndata: {}\n';assert.equal(redactSecretManifests(ordinary),ordinary);
});
let helm=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required');
test('rendered ConfigMap pipeline composes placeholders, review scopes and gRPC deterministically',{skip:!helm},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-configmap-'));
  try {
    const f=await createConfigMapFixture(path.join(root,'inputs'));
    const result=await analyzeSystem(f.root,'accepted.json'),again=await analyzeSystem(f.root,'accepted.json');
    assert.deepEqual(result.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const qa=result.snapshots.find(s=>s.environment==='qa');
    assert.equal(qa.dependencies.filter(d=>d.source==='portal'&&d.target==='orders'&&d.protocol==='gRPC').length,2);
    assert.equal(result.snapshots.find(s=>s.environment==='production').dependencies.some(d=>d.source==='portal'),false);
    assert.ok(result.snapshots.find(s=>s.environment==='production').facts.some(f=>f.predicate==='configuration.reference'&&f.value.kind==='Secret'&&f.value.status==='opaque'));
    assert.doesNotMatch(JSON.stringify(result),/fixture-secret-marker-not-a-credential/);
    await writeAnalysis(result,path.join(root,'export'));
    assert.doesNotMatch(await readFile(path.join(root,'export','analysis.json'),'utf8'),/fixture-secret-marker-not-a-credential/);
    const rendered=await readFile(path.join(root,'export','production%2Fportal.rendered.yaml'),'utf8');
    assert.doesNotMatch(rendered,/fixture-secret-marker-not-a-credential/);assert.match(rendered,/archi.redacted: true/);
    const c=qa.candidates.find(c=>c.source==='portal'),r=qa.resolutions.find(r=>r.id===c.resolutionId);
    assert.equal(qa.facts.filter(f=>r.inputFactIds.includes(f.id)&&f.predicate==='configuration.reference').length,3);
    assert.ok(qa.facts.some(f=>f.predicate==='property.placeholder'&&f.subject==='gateway.peer.port'&&f.value.value==='9090'));
  }finally{await rm(root,{recursive:true,force:true});}
});
