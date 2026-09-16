import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validate,projectGraph,ContractError} from '../src/core/model.mjs';
import {generate,writeGenerated,yaml} from '../src/core/generate.mjs';
const source=JSON.parse(await readFile(new URL('../config/system.json',import.meta.url),'utf8'));
const observations=JSON.parse(await readFile(new URL('../config/observations.json',import.meta.url),'utf8'));
const fresh=()=>[structuredClone(source),structuredClone(observations)];
test('fixture covers three projects, eight services and three contexts',()=>{
 const groups=validate(source,observations);assert.ok(groups.projects.size>=3);assert.ok(groups.services.size>=8);assert.ok(groups.contexts.size>=3);assert.equal(groups.deployments.size,source.deployments.length);
});
for(const [name,mutate,pattern] of [
 ['duplicate identity',c=>c.services.push({...c.services[0]}),/duplicate id/],
 ['dangling service',c=>c.dependencies[0].target='missing',/dangling dependency/],
 ['missing target deployment',c=>c.deployments=c.deployments.filter(d=>!(d.context==='prod-east'&&d.service==='inventory')),/dependency target/],
 ['ambiguous context deployment',c=>c.deployments.push({...c.deployments[0],id:'duplicate'}),/duplicate service deployment/],
 ['unsafe project path',c=>c.projects[0].id='../escape',/invalid id/],
 ['unsafe executable link',c=>c.deployments[0].links.logs='javascript:alert(1)',/HTTPS/],
 ['tag masquerading as source revision',c=>c.deployments[0].sourceCommit='v1.0.0',/full SHA/],
 ['conflicting local ports',c=>c.services[1].port=c.services[0].port,/port must be unique/],
 ['live config sent to simulator',c=>c.system.simulation=false,/explicitly simulated/]
])test(`rejects ${name}`,()=>{const [c,o]=fresh();mutate(c);assert.throws(()=>validate(c,o),pattern);});
test('unknown observations and commits remain unknown',()=>{
 const [c,o]=fresh();o.observations=o.observations.filter(o=>o.deployment!=='prod-east--orders');
 const graph=projectGraph(c,o);assert.equal(graph.instances.find(d=>d.id==='prod-east--orders').status,'unknown');
 const notification=graph.instances.find(d=>d.id==='prod-east--notifications');assert.equal(notification.sourceCommit,null);assert.equal(notification.observed.sourceCommit,null);
});
test('drift compares observed image, readiness and explicitly known commits',()=>{
 const graph=projectGraph(source,observations);assert.deepEqual(graph.instances.find(d=>d.id==='prod-east--payments').drift,['image','replicas']);
 const [c,o]=fresh();o.observations[0].sourceCommit='c'.repeat(40);assert.ok(projectGraph(c,o).instances[0].drift.includes('commit'));
});
test('observation timestamps and identity are validated',()=>{
 for(const mutate of [o=>o.observations[0].deployment='ghost',o=>o.observations.push(o.observations[0]),o=>o.observations[0].observedAt='yesterday',o=>o.observations[0].evidence='design-spec']){
  const [c,o]=fresh();mutate(o);assert.throws(()=>validate(c,o),ContractError);
 }
});
test('generation is deterministic and maps cross-project DNS',()=>{
 const files=generate(source,observations);assert.deepEqual(generate(source,observations),files);
 assert.equal(Object.keys(files).filter(p=>p.startsWith('generated/helm/')).length,source.projects.length*source.contexts.length);
 assert.match(files['generated/helm/prod-east/commerce.yaml'],/inventory.archi-prod.svc.cluster.local:8080/);
 assert.match(files['compose.yaml'],/http:\/\/inventory:8080/);
 const descriptor=JSON.parse(files['examples/projects/commerce/services/orders/service.json']);assert.equal(descriptor.dependencies.length,4);
});
test('generation check catches edits and removes only previously owned stale output',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'archi-test-'));try{
  const files=generate(source,observations);await writeGenerated(root,files);assert.deepEqual(await writeGenerated(root,files,true),[]);
  await writeFile(path.join(root,'web/data.json'),'wrong');assert.ok((await writeGenerated(root,files,true)).includes('web/data.json'));
  await writeGenerated(root,files);const fewer={...files};delete fewer['examples/projects/commerce/project.json'];
  await writeGenerated(root,fewer);await assert.rejects(readFile(path.join(root,'examples/projects/commerce/project.json')),{code:'ENOENT'});
  await writeFile(path.join(root,'generated/manifest.json'),JSON.stringify(['../do-not-delete']));await assert.rejects(writeGenerated(root,files),/ownership/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('YAML serializer preserves implicit scalar types and escaped strings',()=>{
 assert.match(yaml({tag:'true',replicas:0,dependencies:{},services:[],text:'a\nb: c'}),/"tag": "true"/);
 assert.match(yaml({replicas:0}),/"replicas": 0/);
});
