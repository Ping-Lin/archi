import GraphCanvas from './components/GraphCanvas.mjs';
import Inspector from './components/Inspector.mjs';
import CompareTable from './components/CompareTable.mjs';
import AnalysisWorkspace from './components/AnalysisWorkspace.mjs';
import AcceptanceWorkspace from './components/AcceptanceWorkspace.mjs';
import UsageGuide from './components/UsageGuide.mjs';
const {createApp,ref,computed}=Vue;
async function start(){
 createApp(UsageGuide).mount('#usage-guide');
 if(new URLSearchParams(location.search).get('view')==='acceptance'){createApp(AcceptanceWorkspace).mount('#app');return;}
 if(new URLSearchParams(location.search).get('view')==='analysis'){createApp(AnalysisWorkspace).mount('#app');return;}
 const response=await fetch('./data.json');if(!response.ok)throw new Error('Could not load generated architecture data');
 const data=await response.json();
 createApp({components:{GraphCanvas,Inspector,CompareTable},setup(){
  const level=ref('L2'),context=ref(data.contexts.find(c=>c.id==='prod-east')?.id??data.contexts[0].id),selected=ref(data.services.find(s=>s.id==='orders')?.id??data.services[0].id),search=ref(''),project=ref(''),focus=ref(false),tab=ref('map'),compareRight=ref(data.contexts.find(c=>c.id==='prod-west')?.id??data.contexts.at(-1).id),showGuide=ref(false);
  const current=computed(()=>data.contexts.find(c=>c.id===context.value));
  const instances=computed(()=>data.instances.filter(d=>d.context===context.value));
  const drift=computed(()=>instances.value.filter(d=>d.status==='drift').length);
  const matches=computed(()=>data.services.filter(s=>(!project.value||s.project===project.value)&&(!search.value||`${s.name} ${s.id} ${s.project}`.toLowerCase().includes(search.value.toLowerCase()))).length);
  function select(id){selected.value=id;if(data.services.some(s=>s.id===id)&&level.value==='L1')level.value='L2';}
  function drill(id){project.value=id;level.value='L2';selected.value=data.services.find(s=>s.project===id)?.id??id;}
  function exportData(){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='archi-snapshot.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function reset(){project.value='';search.value='';focus.value=false;}
  return {data,level,context,selected,search,project,focus,tab,compareRight,showGuide,current,instances,drift,matches,select,drill,exportData,reset};
 },template:`<div class="workspace">
  <aside class="sidebar"><a class="brand" href="./"><img src="./mark.svg" alt=""><span>archi<span class="brand-dot">.</span></span></a><div class="workspace-switch"><span class="workspace-avatar">{{data.system.name[0]}}</span><div>{{data.system.name}}<span>Architecture workspace</span></div><span class="workspace-chevron">⌄</span></div>
   <div class="nav-label">WORKSPACE</div><button class="nav-item" :class="{active:tab==='map'}" @click="tab='map'"><span>◈</span> Architecture <span class="nav-shortcut">{{data.projects.length}}</span></button><button class="nav-item" :class="{active:tab==='compare'}" @click="tab='compare'"><span>⇄</span> Environments</button>
   <a class="nav-item" href="./?view=analysis"><span>⌘</span> Evidence lab</a><div class="nav-label projects-label">PROJECTS <span>{{data.projects.length}}</span></div><button class="project-item" :class="{chosen:!project}" @click="project=''">All projects <span>{{data.services.length}}</span></button><button v-for="p in data.projects" :key="p.id" class="project-item" :class="{chosen:project===p.id}" @click="project=p.id"><i class="dot" :class="p.id+'-dot'"></i>{{p.name}}<span>{{data.services.filter(s=>s.project===p.id).length}}</span></button>
   <div class="sidebar-bottom"><div class="sandbox-note"><span class="sandbox-icon">✧</span><strong>A safe place to explore</strong><p>Fictional services. Real architecture patterns.</p><button @click="showGuide=true">Explore the demo ↗</button></div><div class="profile"><span class="profile-avatar">P</span><div>Ping’s workspace<small>Local · v0.1.0</small></div><span class="online-dot"></span></div></div>
  </aside>
  <div class="main-shell"><header class="topbar"><div class="breadcrumbs">Workspace <span>/</span> <strong>{{data.system.name}}</strong></div><div class="topbar-right"><span class="fixture-badge"><i></i> Simulation</span><button class="icon-button" aria-label="Open setup guide" @click="showGuide=true">?</button></div></header>
   <main><div class="page-heading"><div><div class="eyebrow">SYSTEM EXPLORER</div><h1>{{tab==='map'?'See the system. Understand the whole.':'Every environment, in context.'}}</h1><p>From logical services to the deployments that bring them to life.</p></div><button class="secondary-button export" @click="exportData">↥ Export snapshot</button></div>
   <div class="summary-grid"><div class="summary-card"><span class="summary-icon purple">◈</span><div><strong>{{data.projects.length}}</strong><span>Connected projects</span></div><span class="summary-meta">L1</span></div><div class="summary-card"><span class="summary-icon blue">▧</span><div><strong>{{data.services.length}}</strong><span>Logical services</span></div><span class="summary-meta">L2</span></div><div class="summary-card"><span class="summary-icon green">▤</span><div><strong>{{instances.length}}</strong><span>Deployment instances</span></div><span class="summary-meta">{{current.environment}}</span></div><div class="summary-card"><span class="summary-icon amber">⌁</span><div><strong>{{drift}}</strong><span>Snapshot differences</span></div><span class="summary-meta">{{drift?'Review':'Aligned'}}</span></div></div>
   <div class="workbench"><div class="workbench-toolbar"><div class="view-tabs" role="tablist" aria-label="Architecture level"><button v-for="v in data.views" :key="v.id" role="tab" :aria-selected="level===v.level&&tab==='map'" :class="{active:level===v.level&&tab==='map'}" @click="level=v.level;tab='map'">{{v.level==='L1'?'System':v.level==='L2'?'Services':'Deployments'}}<small>{{v.level==='deployment'?'L3':v.level}}</small></button></div><label class="context-picker"><span class="context-dot"></span><select aria-label="Deployment context" v-model="context"><option v-for="c in data.contexts" :key="c.id" :value="c.id">{{c.name}}</option></select></label></div>
    <div class="workbench-body"><div class="canvas-area"><div class="filterbar"><label class="search"><span>⌕</span><input v-model="search" placeholder="Find a service or project…" aria-label="Search services"><kbd>/</kbd></label><button class="filter-button" :class="{enabled:focus}" @click="focus=!focus" v-if="tab==='map'">◎ Focus neighbors</button><button class="text-button" v-if="search||project||focus" @click="reset">Clear</button></div>
    <div class="filter-status" v-if="search||project">{{matches}} matching services <span v-if="project">in {{project}}</span></div>
    <GraphCanvas v-if="tab==='map'" :data="data" :level="level" :context="context" :selected="selected" :search="search" :project="project" :focus="focus" @select="select" @drill="drill"/>
    <CompareTable v-else :data="data" v-model:left="context" v-model:right="compareRight" :search="search" :project="project" @select="select"/>
    </div><Inspector :data="data" :selected="selected" :context="context" @select="select"/></div>
    <footer class="workbench-footer"><span><i class="tiny-dot"></i> {{data.snapshotMode}}</span><span>{{current.cluster}} <b>/</b> {{current.namespace}}</span><span>Evidence preserved · no inferred commits</span></footer>
   </div><div class="page-footer"><span>Architecture is a shared understanding.</span><span>Made for exploration, built for clarity.</span></div></main>
  </div>
  <div v-if="showGuide" class="modal-backdrop" @click.self="showGuide=false" @keydown.esc="showGuide=false"><section class="guide" role="dialog" aria-modal="true" aria-label="Demo guide"><button class="close-button" @click="showGuide=false" aria-label="Close guide">×</button><div class="eyebrow">YOUR FIRST EXPLORATION</div><h2>Follow the connections.</h2><ol><li><strong>Start with services.</strong> Select Order Service to see its cross-project dependencies.</li><li><strong>Inspect deployment drift.</strong> Switch to Deployments and select Payment Adapter in Production East.</li><li><strong>Compare contexts.</strong> Open Environments to find older orders and inventory versions in Production West.</li><li><strong>Check what is unknown.</strong> Notification Worker intentionally has no source commit evidence.</li></ol><div class="guide-command"><span>Run the complete local simulation</span><code>npm run demo</code></div><p>The setup skill maintains configuration, fixtures and generated outputs together. See the repository’s setup documentation.</p><button class="primary-button" @click="showGuide=false">Explore the architecture →</button></section></div>
 </div>`}).mount('#app');
 document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();document.querySelector('.search input')?.focus();}});
}
start().catch(error=>{document.querySelector('#app').textContent=`Unable to open workspace: ${error.message}. Run npm run generate and retry.`;});
