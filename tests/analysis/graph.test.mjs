import test from 'node:test';
import assert from 'node:assert/strict';
import {projectServiceGraph} from '../../web/analysis-graph.mjs';
const fixture=()=>({environment:'dev',resolutions:[{id:'r'}],candidates:[{id:'a',name:'clientA',source:'caller',target:'api',eligibility:'enabled',targetResolution:'unique',resolutionId:'r',reasons:[]},{id:'b',name:'clientB',source:'caller',target:'hidden',eligibility:'disabled',targetResolution:'unique',resolutionId:'r',reasons:[]}],dependencies:[{id:'e',source:'caller',target:'api',candidateId:'a',resolutionId:'r',environment:'dev',targetKind:'external',protocol:'HTTPS'}]});
test('multi-caller cycles, disconnected and zero-candidate callers remain finite and distinct',()=>{
 const s=fixture();s.callers=['caller','api','idle'];
 s.candidates.push({...s.candidates[0],id:'back',source:'api',target:'caller'});
 s.dependencies.push({...s.dependencies[0],id:'back',source:'api',target:'caller',candidateId:'back',targetKind:'service'});
 const g=projectServiceGraph(s);assert.equal(g.nodes.length,3);
 assert.ok(g.nodes.every(n=>Number.isFinite(n.y)&&n.x>=0));
 assert.notEqual(g.edges[0].path,g.edges[1].path);
 assert.ok(g.nodes.some(n=>n.id==='idle'));
});
test('graph uses only resolved environment dependencies and keeps excluded candidates',()=>{const graph=projectServiceGraph(fixture());assert.equal(graph.edges.length,1);assert.deepEqual(graph.nodes.map(n=>n.id),['caller','api']);assert.equal(graph.excluded[0].name,'clientB');});
test('graph rejects cross-environment, unexplained and disabled edges',()=>{const s=fixture();s.dependencies.push({...s.dependencies[0],id:'foreign',environment:'prod'},{...s.dependencies[0],id:'disabled',candidateId:'b',target:'hidden'},{...s.dependencies[0],id:'missing',resolutionId:'missing'});assert.equal(projectServiceGraph(s).edges.length,1);});
test('search filters the projection without changing the snapshot',()=>{const s=fixture(),before=JSON.stringify(s);assert.equal(projectServiceGraph(s,'missing').edges.length,0);assert.equal(projectServiceGraph(s,'clientA').edges.length,1);assert.equal(JSON.stringify(s),before);});
test('layout supports parallel candidate edges and self references',()=>{const s=fixture();s.candidates.push({...s.candidates[0],id:'c',name:'other'});s.dependencies.push({...s.dependencies[0],id:'parallel',candidateId:'c'});let g=projectServiceGraph(s);assert.notEqual(g.edges[0].labelY,g.edges[1].labelY);s.candidates[0].target='caller';s.dependencies[0].target='caller';g=projectServiceGraph(s);assert.ok(g.edges[0].path.includes('C'));assert.ok(g.nodes.every(n=>Number.isFinite(n.y)));});
