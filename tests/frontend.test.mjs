import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
// Compile every maintained Vue template using the exact shipped runtime.
const source=await readFile(new URL('../web/vendor/vue-3.5.13.global.prod.js',import.meta.url),'utf8');
vm.runInThisContext(source);
for(const file of ['GraphCanvas','Inspector','CompareTable','AnalysisWorkspace','AnalysisGraph','DataContext','RuntimeRefresh','UsageGuide'])test(`${file} template compiles`,async()=>{
 const component=(await import(`../web/components/${file}.mjs`)).default;
 assert.equal(typeof Vue.compile(component.template,{decodeEntities: text=>text, onError:error=>{throw error;}}),'function');
});
test('root template compiles without DOM or network',async()=>{
 const app=await readFile(new URL('../web/app.mjs',import.meta.url),'utf8');
 const start=app.indexOf('template:`')+'template:`'.length,end=app.indexOf('`}).mount',start);
 assert.ok(start>0&&end>start);assert.equal(typeof Vue.compile(app.slice(start,end),{decodeEntities: text=>text, onError:error=>{throw error;}}),'function');
});
