import test from 'node:test';
import assert from 'node:assert/strict';
import {createMock} from '../src/mock/server.mjs';
import {listen,createExplorer,startDemo} from '../src/core/server.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const close=s=>new Promise(r=>{s.close(r);s.closeAllConnections();});
test('mock chain performs actual calls and terminates cycles',async()=>{
 const dependencies={};const a=createMock({id:'a',dependencies}),b=createMock({id:'b'});
 await listen(a,0);await listen(b,0);dependencies.b=`http://127.0.0.1:${b.address().port}`;
 try{
  const url=`http://127.0.0.1:${a.address().port}`;
  const response=await fetch(url+'/simulate');const body=await response.json();assert.equal(body.ok,true);assert.equal(body.calls[0].service,'b');
  assert.equal((await fetch(url+'/simulate?visited=a')).status,508);
  assert.equal((await fetch(url+'/simulate?budget=NaN')).status,400);
  assert.equal((await fetch(url+'/not-found')).status,404);
  dependencies.b=url;const cyclic=await(await fetch(url+'/simulate')).json();assert.equal(cyclic.ok,false);assert.match(cyclic.calls[0].error,/cycle/);
 }finally{await close(a);await close(b);}
});
test('dependency failure is observable without hanging',async()=>{
 const server=createMock({id:'a',dependencies:{missing:'http://127.0.0.1:1'},timeout:100});await listen(server,0);
 try{const data=await(await fetch(`http://127.0.0.1:${server.address().port}/simulate`)).json();assert.equal(data.ok,false);assert.ok(data.calls[0].error);assert.ok(data.elapsedMs<1000);}finally{await close(server);}
});
test('explorer serves generated data and blocks traversal',async()=>{
 const server=createExplorer(root);await listen(server,0);const url=`http://127.0.0.1:${server.address().port}`;
 try{
  const response=await fetch(url+'/');assert.match(await response.text(),/Architecture workspace/);
  const graph=await(await fetch(url+'/data.json')).json();assert.ok(graph.instances.length>=24);
  assert.equal((await fetch(url+'/%2e%2e%2fpackage.json')).status,404);
  assert.equal((await fetch(url+'/data.json',{method:'POST'})).status,405);
 }finally{await close(server);}
});
test('entire demo starts, visits dependencies and shuts down',async()=>{
 const config=JSON.parse(await readFile(new URL('../config/system.json',import.meta.url),'utf8'));
 // Ask the OS for free ports before starting the complete fixture.
 const probes=[];for(const s of config.services){const probe=createMock({id:s.id});await listen(probe,0);probes.push(probe);s.port=probe.address().port;}
 await Promise.all(probes.map(close));
 const runtime=await startDemo(root,config,{port:0});
 try{
  assert.equal((await fetch(runtime.url)).status,200);
  const response=await(await fetch(`http://127.0.0.1:${config.services[0].port}/simulate`)).json();
  const visited=new Set();function visit(node){visited.add(node.service);assert.equal(node.ok,true);node.calls.forEach(visit);}visit(response);assert.equal(visited.size,config.services.length);
 }finally{await runtime.close();}
});
