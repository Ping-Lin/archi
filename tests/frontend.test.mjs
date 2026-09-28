import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
// Compile every maintained Vue template using the exact shipped runtime.
const source=await readFile(new URL('../web/vendor/vue-3.5.13.global.prod.js',import.meta.url),'utf8');
vm.runInThisContext(source);
for(const file of ['GraphCanvas','Inspector','CompareTable','AnalysisWorkspace','AnalysisGraph','DataContext','RuntimeRefresh','RuntimePanel','AnalysisTabs','UsageGuide'])test(`${file} template compiles`,async()=>{
 const component=(await import(`../web/components/${file}.mjs`)).default;
 assert.equal(typeof Vue.compile(component.template,{decodeEntities: text=>text, onError:error=>{throw error;}}),'function');
});
test('contextual help distinguishes missing, synthetic, pending and failed inputs',async()=>{
 const {contextualHelp:h}=await import('../web/help-context.mjs');
 assert.match(h('analysis',{}).title,/Prepare/);
 const state={analysis:{loaded:true,tab:'runtime',environment:'qa',simulation:true},refresh:{}};
 assert.match(h('analysis',state).title,/synthetic/);
 state.analysis.simulation=false;
 assert.match(h('analysis',state).title,/checklist/);
 state.refresh={pending:true,scope:'qa / commerce'};
 assert.match(h('analysis',state).text,/qa \/ commerce/);
 state.refresh={failed:true,recovery:'setup'};
 assert.match(h('analysis',state).text,/Reload setup/);
 state.refresh.recovery='stored';
 assert.match(h('analysis',state).text,/Reload stored analysis/);
 state.refresh={ready:true};state.analysis.runtime=true;
 assert.match(h('analysis',state).title,/stored workload/);
 state.analysis.tab='traffic';
 assert.match(h('analysis',state).title,/No traffic/);
 assert.match(h('acceptance',{}).title,/offline/);
 assert.match(h(null,{}).title,/fictional/);
});
test('root template compiles without DOM or network',async()=>{
 const app=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');
 const start=app.indexOf('template:`')+'template:`'.length,end=app.indexOf('`}).mount',start);
 assert.ok(start>0&&end>start);assert.equal(typeof Vue.compile(app.slice(start,end),{decodeEntities: text=>text, onError:error=>{throw error;}}),'function');
});
