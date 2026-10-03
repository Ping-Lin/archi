import test from 'node:test';
import assert from 'node:assert/strict';
import {stringify} from 'yaml';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';
import {parseManifest} from '../../src/analysis/helm.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createMountedConfigFixture} from '../../scripts/mounted-config-fixture.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';
import {validateSystem} from '../../src/analysis/system-contract.mjs';

function context(edit=()=>{}){
  const env={id:'qa',cluster:'cluster',namespace:'app',profiles:['qa'],propertiesComplete:true,propertyFiles:['base.properties'],environmentBindings:[],importProfilePolicy:'no-variants-reviewed',importBindings:[],mountedFiles:['/config/app.properties']};
  const container={env:[{name:'SPRING_PROFILES_ACTIVE',value:'qa'},{name:'SPRING_CONFIG_ADDITIONAL_LOCATION',value:'file:/config/app.properties'}],volumeMounts:[{name:'config',mountPath:'/config',readOnly:true}]};
  const volume={name:'config',configMap:{name:'settings'}};
  const configMap={apiVersion:'v1',kind:'ConfigMap',metadata:{name:'settings'},data:{'app.properties':'peer.host=${routing.host}\nrouting.host=orders\npeer.port=8000\n'}};
  edit({env,container,volume,configMap});
  const deployment={apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'portal',labels:{'app.kubernetes.io/name':'portal'}},spec:{template:{spec:{containers:[container],volumes:[volume]}}}};
  const ledger=createLedger('qa','portal'),{resources}=parseManifest([deployment,configMap].map(d=>stringify(d)).join('---\n'),env,ledger);
  return {env,resources,ledger,source:{service:'portal'},files:new Map([['base.properties','peer.host=base\npeer.port=7000\n']])};
}
test('mounted files override roots, resolve placeholders and retain render provenance',()=>{
  const c=context(),p=runAdapter('spring-properties/6',c);
  assert.equal(p.complete,true,JSON.stringify(p.diagnostics));
  assert.equal(p.values['peer.host'],'orders');assert.equal(p.values['peer.port'],'8000');
  const facts=c.ledger.facts.filter(f=>f.predicate==='configuration.mount');
  assert.equal(facts.length,1);assert.equal(facts[0].value.path,'/config/app.properties');
  assert.ok(facts[0].evidenceIds.length);assert.ok(p.referenceFactIds.includes(facts[0].id));
  assert.equal(runAdapter('spring-properties/5',context()).complete,false);
});
test('items remapping, exact file subPath and YAML are supported',()=>{
  for(const subPath of [false,true]){
    const p=runAdapter('spring-properties/6',context(({env,container,volume,configMap})=>{
      configMap.data={payload:'peer:\n  host: stock\n  port: 8100\n'};
      volume.configMap.items=[{key:'payload',path:'nested/app.yaml',mode:420}];
      container.volumeMounts=[{name:'config',mountPath:subPath?'/config/app.yaml':'/config',...(subPath?{subPath:'nested/app.yaml'}:{})}];
      env.mountedFiles=[subPath?'/config/app.yaml':'/config/nested/app.yaml'];
      container.env[1].value='file:'+env.mountedFiles[0];
    }));
    assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.host'],'stock');
  }
});
test('ordered mounted files precede mapped env and application JSON',()=>{
  for(const level of [0,1,2]){
    const p=runAdapter('spring-properties/6',context(({env,container,configMap})=>{
      configMap.data['override.yaml']='peer:\n  port: 8200\n';
      env.mountedFiles.push('/config/override.yaml');container.env[1].value=env.mountedFiles.map(p=>'file:'+p).join(',');
      if(level>=1){env.environmentBindings=[{name:'PEER_PORT',key:'peer.port'}];container.env.push({name:'PEER_PORT',value:'9000'});}
      if(level===2)container.env.push({name:'SPRING_APPLICATION_JSON',value:'{"peer.port":"9090"}'});
    }));
    assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.port'],['8200','9000','9090'][level]);
  }
});
test('additional-location can come from a scoped ConfigMap key reference',()=>{
  const p=runAdapter('spring-properties/6',context(({container,volume,configMap})=>{
    configMap.data.location='file:/config/app.properties';
    volume.configMap.items=[{key:'app.properties',path:'app.properties'}];
    container.env[1]={name:'SPRING_CONFIG_ADDITIONAL_LOCATION',valueFrom:{configMapKeyRef:{name:'settings',key:'location'}}};
  }));
  assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.host'],'orders');
  assert.equal(p.referenceFactIds.length,2);
});
function importContext(edit=()=>{}){
  return context(c=>{
    c.configMap.data['app.properties']='peer.host=base\npeer.port=8000\nspring.config.import=leaf.properties';
    c.configMap.data['leaf.properties']='peer.host=${routing.host}\nrouting.host=orders\npeer.port=8100';
    c.env.mountedImportBindings=[{from:'/config/app.properties',location:'leaf.properties',file:'/config/leaf.properties'}];
    edit(c);
  });
}
test('v7 mounted imports override declaring files with mount and import evidence',()=>{
  const c=importContext(),p=runAdapter('spring-properties/7',c);
  assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.host'],'orders');assert.equal(p.values['peer.port'],'8100');
  assert.equal(c.ledger.facts.filter(f=>f.predicate==='configuration.import').length,1);
  assert.equal(p.referenceFactIds.length,3);
  assert.equal(runAdapter('spring-properties/6',importContext()).complete,false);
});
test('v7 nested and ordered optional-present imports preserve precedence',()=>{
  const p=runAdapter('spring-properties/7',importContext(({env,configMap})=>{
    configMap.data['leaf.properties']+='\nspring.config.import=optional:second.yaml';
    configMap.data['second.yaml']='peer:\n  port: 8200';
    env.mountedImportBindings.push({from:'/config/leaf.properties',location:'optional:second.yaml',file:'/config/second.yaml'});
  }));
  assert.equal(p.complete,true,JSON.stringify(p.diagnostics));assert.equal(p.values['peer.port'],'8200');
});
test('v7 blocks unbound, missing, redirected, cyclic, repeated and profile-variant imports',()=>{
  const edits=[
    ({env})=>env.mountedImportBindings=[],
    ({configMap})=>delete configMap.data['leaf.properties'],
    ({env})=>env.mountedImportBindings[0].file='/other/leaf.properties',
    ({env,configMap})=>{configMap.data['app.properties']='spring.config.import=optional:missing.properties';env.mountedImportBindings=[{from:'/config/app.properties',location:'optional:missing.properties',file:'/config/missing.properties'}];},
    ({env,configMap})=>{configMap.data['leaf.properties']='spring.config.import=app.properties';env.mountedImportBindings.push({from:'/config/leaf.properties',location:'app.properties',file:'/config/app.properties'});},
    ({configMap})=>configMap.data['app.properties']='spring.config.import=leaf.properties,leaf.properties',
    ({env})=>env.mountedImportBindings.push({...env.mountedImportBindings[0]}),
    ({configMap})=>configMap.data['leaf-qa.properties']='peer.port=1234',
    ({configMap})=>configMap.data['leaf.properties']='spring.config.import=https://example.invalid/x.properties',
    ({configMap})=>configMap.data['leaf.properties']='spring.config.import=../outside.properties',
    ({env})=>env.mountedImportBindings.push({from:'/config/unused.properties',location:'leaf.properties',file:'/config/leaf.properties'}),
  ];
  for(const edit of edits)assert.equal(runAdapter('spring-properties/7',importContext(edit)).complete,false,edit.toString());
});
test('uncaptured or ambiguous mounts never produce complete configuration',()=>{
  const edits=[
    ({container})=>container.env.pop(),
    ({container})=>container.env[1].value='optional:file:/config/app.properties',
    ({container})=>container.volumeMounts[0].mountPath='/config/../config',
    ({container})=>container.volumeMounts[0].subPathExpr='$(FILE)',
    ({container})=>container.volumeMounts.push({...container.volumeMounts[0]}),
    ({container})=>container.volumeMounts[0].subPath='missing',
    ({container})=>delete container.volumeMounts[0].name,
    ({volume})=>volume.configMap={name:'missing',optional:true},
    ({volume})=>volume.configMap.defaultMode=999,
    ({volume})=>{delete volume.configMap;volume.secret={secretName:'settings'};},
    ({volume})=>volume.configMap.items=[{key:'missing',path:'app.properties'}],
    ({volume})=>volume.configMap.items=[{key:'app.properties',path:'../app.properties'}],
    ({volume})=>volume.configMap.items=[{key:'app.properties',path:'app.properties',mode:-1}],
    ({configMap})=>configMap.metadata.namespace='other',
    ({configMap})=>configMap.binaryData={opaque:'YQ=='},
    ({configMap})=>configMap.data['app.properties']=17,
    ({configMap})=>configMap.data['extra.properties']='x=y',
    ({configMap})=>configMap.data['app.properties']='spring.config.import=extra.properties',
    ({configMap})=>configMap.data['app.properties']='spring.config.activate.on-profile=qa',
    ({env,container,configMap})=>{env.mountedFiles.push('/config/app-qa.properties');container.env[1].value=env.mountedFiles.map(p=>'file:'+p).join(',');configMap.data['app-qa.properties']='peer.port=8900';},
    ({env})=>env.propertiesComplete=false,
    ({env})=>delete env.importProfilePolicy,
  ];
  for(const edit of edits)assert.equal(runAdapter('spring-properties/6',context(edit)).complete,false,edit.toString());
});
let helm=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required');
test('mounted configuration composes through pinned Helm inputs and candidate evidence',{skip:!helm},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'archi-mounted-'));
  try{
    const f=await createMountedConfigFixture(path.join(root,'inputs'));
    for(const paths of [[],['relative.properties'],['/config/../app.properties'],['/config/a.properties','/config/a.properties'],['/config/file.txt']]){
      const invalid=structuredClone(f.accepted);
      invalid.environments[0].instances.find(i=>i.id==='portal').configuration.mountedFiles=paths;
      assert.throws(()=>validateSystem(invalid),undefined,JSON.stringify(paths));
    }
    const result=await analyzeSystem(f.root,'accepted.json'),again=await analyzeSystem(f.root,'accepted.json');
    assert.deepEqual(result.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const qa=result.snapshots.find(s=>s.environment==='qa');
    assert.equal(qa.dependencies.filter(d=>d.source==='portal'&&d.target==='orders'&&d.protocol==='gRPC').length,2);
    assert.equal(result.snapshots.find(s=>s.environment==='production').dependencies.some(d=>d.source==='portal'),false);
    const mount=qa.facts.find(f=>f.predicate==='configuration.mount');
    assert.equal(mount.value.path,'/etc/archi-config/routing.properties');
    const candidate=qa.candidates.find(c=>c.source==='portal');
    assert.ok(qa.resolutions.find(r=>r.id===candidate.resolutionId).inputFactIds.includes(mount.id));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('v7 composes mounted import trees with deterministic system snapshots',{skip:!helm},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'archi-mounted-imports-'));
  try{
    const f=await createMountedConfigFixture(path.join(root,'inputs'),{imports:true});
    for(const edit of [
      c=>c.mountedImportBindings[0].from='relative.properties',
      c=>c.mountedImportBindings[0].file='/config/../escape.properties',
      c=>c.mountedImportBindings.push({...c.mountedImportBindings[0]}),
      c=>c.adapter='spring-properties/6',
    ]){
      const invalid=structuredClone(f.accepted);edit(invalid.environments[0].instances.find(i=>i.id==='portal').configuration);
      assert.throws(()=>validateSystem(invalid),undefined,edit.toString());
    }
    const a=await analyzeSystem(f.root,'accepted.json'),b=await analyzeSystem(f.root,'accepted.json');
    assert.deepEqual(a.snapshots.map(s=>s.contentHash),b.snapshots.map(s=>s.contentHash));
    const qa=a.snapshots.find(s=>s.environment==='qa');
    assert.equal(qa.dependencies.filter(d=>d.source==='portal'&&d.target==='orders'&&d.protocol==='gRPC').length,2);
    const imported=qa.facts.find(f=>f.predicate==='configuration.import'&&f.value.target==='/etc/archi-config/leaf.properties');
    assert.ok(imported);
    const candidate=qa.candidates.find(c=>c.source==='portal');
    assert.ok(qa.resolutions.find(r=>r.id===candidate.resolutionId).inputFactIds.includes(imported.id));
  }finally{await rm(root,{recursive:true,force:true});}
});
