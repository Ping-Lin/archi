import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlaceholders,PLACEHOLDER_LIMITS} from '../../src/analysis/placeholders.mjs';
import {runAdapter} from '../../src/analysis/adapters.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';

test('placeholders resolve exact references, recursive values and lazy nested defaults',()=>{
  const raw={host:'orders',port:'8080',address:'http://${host}:${port}',alias:'${address}',
    fallback:'${absent:${host}:9090}',empty:'',kept:'${empty:not-used}',emptyDefault:'${missing:}',
    unused:'${host:${alsoMissing}}'};
  const r=resolvePlaceholders(raw);assert.deepEqual(r.errors,[]);
  assert.equal(r.values.alias,'http://orders:8080');assert.equal(r.values.fallback,'orders:9090');
  assert.equal(r.values.kept,'');assert.equal(r.values.emptyDefault,'');assert.equal(r.values.unused,'orders');
  assert.deepEqual(r.traces.alias.references,['address','host','port']);
  assert.deepEqual(r.traces.fallback.defaults,['absent']);assert.equal(raw.alias,'${address}');
});
test('cycles, missing values, dynamic names, expressions, escaping and relaxed-name aliases remain unknown',()=>{
  for(const raw of [{a:'${b}',b:'${a}'},{a:'${missing}'},{a:'${a:default}'},{a:'${key'},
    {a:'${prefix.${name}}',name:'x'}, {a:'${host:{fallback}}',host:'orders'}, {a:'\\${key}'},{a:'#{1+1}'},{a:'$(HOST)'},
    {a:'${random.int:123}'},{a:'${spring.application.name:guess}'},
    {a:'${peer-host:fallback}',peerHost:'real'}, {a:'${peer-host}', 'peer-host':'one',peerHost:'two'}]) {
    assert.ok(resolvePlaceholders(raw).errors.length,JSON.stringify(raw));
  }
  assert.ok(resolvePlaceholders({a:'${HOST:fallback}'},['HOST']).errors.length);
  const proto=Object.create(null);proto.__proto__='orders';proto.a='${__proto__}';
  assert.equal(resolvePlaceholders(proto).values.a,'orders');
});
test('host process environment cannot satisfy references and expansion work is bounded',()=>{
  const previous=process.env.ARCHI_PLACEHOLDER_TEST;process.env.ARCHI_PLACEHOLDER_TEST='must-not-read';
  try{assert.equal(resolvePlaceholders({a:'${ARCHI_PLACEHOLDER_TEST:explicit-default}'}).values.a,'explicit-default');}
  finally{if(previous===undefined)delete process.env.ARCHI_PLACEHOLDER_TEST;else process.env.ARCHI_PLACEHOLDER_TEST=previous;}
  assert.ok(resolvePlaceholders({a:'x'.repeat(PLACEHOLDER_LIMITS.value+1)}).errors.length);
  const bomb={v0:'x'};for(let i=1;i<25;i++)bomb['v'+i]=('${v'+(i-1)+'}').repeat(4);
  assert.ok(resolvePlaceholders(bomb).errors.length);
  const cycle={};for(let i=0;i<40;i++)cycle['v'+i]='${v'+(i+1)+'}';cycle.v40='end';
  assert.ok(resolvePlaceholders(cycle).errors.length);
  assert.ok(resolvePlaceholders(Object.fromEntries(Object.entries(cycle).reverse())).errors.length);
  assert.ok(resolvePlaceholders(Object.fromEntries(Array.from({length:2049},(_,i)=>['k'+i,'v']))).errors.length);
});

function context() {return {
  files:new Map([['app.properties','peer.host=${HOST:fallback}\npeer.port=${port.alias:7070}\nport.alias=${PORT:8080}\nunused=${missing}\n'],['override.yaml','unused: overridden\n']]),
  env:{id:'qa',profiles:['qa'],propertiesComplete:true,propertyFiles:['app.properties','override.yaml'],environmentBindings:[{name:'HOST',key:'HOST'},{name:'PORT',key:'PORT'}]},
  source:{service:'portal'},ledger:createLedger('qa','portal'),
  resources:[{kind:'Deployment',service:'portal',key:'workload',spec:{template:{spec:{containers:[{env:[
    {name:'HOST',value:'orders'}, {name:'PORT',value:'8080'}, {name:'SPRING_PROFILES_ACTIVE',value:'qa'},
    {name:'SPRING_APPLICATION_JSON',value:'{"PORT":9090}'},
  ]}]}}}}],
};}
test('v3 evaluates final effective values and retains transitive source facts and default assumptions',()=>{
  const c=context(),p=runAdapter('spring-properties/3',c);
  assert.equal(p.complete,true);assert.equal(p.values['peer.host'],'orders');assert.equal(p.values['peer.port'],'9090');
  assert.equal(p.values.unused,'overridden');
  const facts=c.ledger.facts.filter(f=>p.chains['peer.port'].includes(f.id));
  assert.ok(facts.some(f=>f.subject==='PORT'&&f.value.value==='8080'));
  assert.ok(facts.some(f=>f.subject==='PORT'&&f.value.value==='9090'));
  const derived=facts.find(f=>f.predicate==='property.placeholder');
  assert.deepEqual(derived.value.references,['PORT','port.alias']);
  assert.ok(derived.evidenceIds.every(id=>c.ledger.evidence.some(e=>e.id===id)));
  const d=context();d.env.environmentBindings=[];d.resources[0].spec.template.spec.containers[0].env=d.resources[0].spec.template.spec.containers[0].env.filter(v=>!['HOST','PORT'].includes(v.name));
  const result=runAdapter('spring-properties/3',d);assert.equal(result.complete,true);
  assert.equal(result.values['peer.host'],'fallback');
  assert.deepEqual(d.ledger.facts.find(f=>f.predicate==='property.placeholder'&&f.subject==='peer.host').value.defaultsUsed,['HOST']);
});
test('incomplete scope cannot become complete through defaults; v2 behavior remains unchanged',()=>{
  for(const edit of [c=>c.env.propertiesComplete=false,c=>c.resources[0].spec.template.spec.containers[0].envFrom=[{}],
    c=>c.resources[0].spec.template.spec.containers[0].env.push({name:'UNKNOWN',value:'x'}),
    c=>c.files.set('override.yaml','unused: overridden\nspring.config.import: missing.properties\n')]) {
    const c=context();edit(c);const p=runAdapter('spring-properties/3',c);
    assert.equal(p.complete,false);assert.equal(p.values['peer.host'],'${HOST:fallback}');
    assert.ok(p.diagnostics.some(d=>d.code==='PLACEHOLDER_SCOPE_INCOMPLETE'));
  }
  assert.equal(runAdapter('spring-properties/2',context()).complete,false);
});
