import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {resolveGrpcEndpoint,resolveEndpointBinding} from '../../src/analysis/endpoint-binding.mjs';
import {createGrpcFixture} from '../../scripts/grpc-fixture.mjs';
import {analyzeSystem} from '../../src/analysis/system-run.mjs';
import {captureSystem} from '../../src/analysis/repositories.mjs';
import {verifyAiBundle,candidateHash} from '../../src/analysis/ai-candidates.mjs';
const dns={kind:'grpc-dns',key:'target'},split={kind:'host-port',hostKey:'host',portKey:'port'};
test('gRPC identities accept only bounded DNS targets or explicit host/port',()=>{
  assert.equal(resolveGrpcEndpoint(dns,{target:'dns:///API.sales.svc.cluster.local.:09090'}),'grpc://api.sales.svc.cluster.local:9090');
  assert.equal(resolveGrpcEndpoint(split,{host:'api.sales',port:'9090'}),'grpc://api.sales:9090');
  for(const target of ['api:9090','grpc://api:9090','dns://resolver/api:9090','dns:///api','dns:///api:0','dns:///api:65536','dns:///api:9090/path','dns:///api:9090?x=1','dns:///user@api:9090','dns:///a%70i:9090','dns:///[::1]:9090','xds:///api:9090','unix:///tmp/socket','dns:///api:9090\n'])assert.equal(resolveGrpcEndpoint(dns,{target}),null,target);
  for(const host of ['','api..sales','-api','api/path','api@host','api:9090',' api'])assert.equal(resolveGrpcEndpoint(split,{host,port:'9090'}),null,host);
  assert.equal(resolveGrpcEndpoint(split,{host:'api',port:9090}),null);
  assert.equal(resolveEndpointBinding(split,'gRPC',{host:'api',port:'9090'}),null,'old binding adapter stays closed');
});
let helm=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{helm=false;}
if(process.env.CI&&!helm)throw Error('Helm required');
test('gRPC fixture validates evidence, scoped reviews, protocol binding and deterministic results',{skip:!helm},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'archi-grpc-'));
  try {
    const f=await createGrpcFixture(path.join(root,'inputs')),inputs=await captureSystem(f.root,'system.json'),service=f.manifest.services.find(s=>s.id==='portal');
    const verify=(bundle,s=service)=>verifyAiBundle(bundle,{service:s,simulation:true,files:inputs.files,provenance:inputs.provenance});
    verify(f.bundle);
    const v2=structuredClone(service);v2.source.adapter='ai-evidence/2';assert.throws(()=>verify(f.bundle,v2));
    const wrong=structuredClone(f.bundle);wrong.candidates[1].protocol='HTTP';assert.throws(()=>verify(wrong),/grpc-dns/);
    const changed=structuredClone(f.bundle.candidates[0]);changed.protocol='TCP';assert.notEqual(candidateHash(f.bundle,changed),candidateHash(f.bundle,f.bundle.candidates[0]));
    const first=await analyzeSystem(f.root,'accepted.json'),again=await analyzeSystem(f.root,'accepted.json');
    assert.deepEqual(first.snapshots.map(s=>s.contentHash),again.snapshots.map(s=>s.contentHash));
    const qa=first.snapshots.find(s=>s.environment==='qa'),edges=qa.dependencies.filter(d=>d.source==='portal');
    assert.equal(edges.length,2);for(const edge of edges){assert.equal(edge.target,'orders');assert.equal(edge.protocol,'gRPC');assert.equal(edge.transportSecurity,'unknown');}
    assert.equal(first.snapshots.find(s=>s.environment==='production').dependencies.some(d=>d.source==='portal'),false);
    const facts=qa.facts.filter(f=>f.predicate==='endpoint.binding');assert.equal(facts.length,2);
    for(const fact of facts){assert.equal(fact.value.url,'grpc://api.sales-qa.svc.cluster.local:9090');assert.ok(fact.evidenceIds.length);}
    for(const variant of ['protocol','port','cluster','namespace']) {
      const manifest=structuredClone(f.accepted),env=manifest.environments.find(e=>e.id==='qa');
      const instance=env.instances.find(i=>i.id==='orders'),release=env.releases.find(r=>r.id==='orders');
      if(variant==='protocol')instance.endpoint.protocol='HTTP';
      if(variant==='port')instance.endpoint.port=8080;
      if(variant==='cluster')release.cluster='another';
      if(variant==='namespace')release.namespace='another';
      await writeFile(path.join(f.root,'negative.json'),JSON.stringify(manifest));
      const result=(await analyzeSystem(f.root,'negative.json')).snapshots.find(s=>s.environment==='qa');
      assert.equal(result.dependencies.some(d=>d.source==='portal'),false,variant);
    }
    const out=path.join(root,'template.json');
    execFileSync(process.execPath,['scripts/ai-candidates.mjs','template','--root',f.root,'--system','system.json','--service','portal','--out',out]);
    assert.equal(JSON.parse(await readFile(out,'utf8')).schemaVersion,'archi/ai-candidates-v1alpha3');
  }finally{await rm(root,{recursive:true,force:true});}
});
