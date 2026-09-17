import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {analyze,checkOracle} from '../../src/analysis/run.mjs';
import {projectServiceGraph} from '../../web/analysis-graph.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
let available=true;try{execFileSync(process.env.HELM_BIN??'helm',['version','--short'],{stdio:'ignore'});}catch{available=false;}
if(process.env.CI&&!available)throw new Error('Helm required for onboarding gate');
test('second layout onboards through configuration without extractor changes',{skip:!available},async()=>{
 const a=await analyze(root,'examples/logistics/archi.config.json',{asOf:'2026-09-17T00:00:00Z'});
 await checkOracle(a,root+'/tests/fixtures/logistics-oracle.json');
 const b=await analyze(root,'examples/logistics/archi.config.json',{asOf:'2026-09-18T00:00:00Z'});
 assert.deepEqual(a.snapshots.map(s=>s.contentHash),b.snapshots.map(s=>s.contentHash));
 for(const s of a.snapshots){const g=projectServiceGraph(s);assert.equal(g.edges.length,2);assert.ok(g.edges.every(e=>e.source==='dispatcher'));assert.ok(!g.nodes.some(n=>n.id==='checkout'));assert.equal(s.candidates.find(c=>c.name==='dynamic').eligibility,'unknown');assert.ok(s.candidates.every(c=>c.runtimeSupport==='unavailable'));}
 assert.deepEqual(projectServiceGraph(a.snapshots[0]).edges.map(e=>e.target).sort(),['audit','routing-hub']);
 assert.deepEqual(projectServiceGraph(a.snapshots[1]).edges.map(e=>e.target).sort(),['routing-hub','webhook']);
});
