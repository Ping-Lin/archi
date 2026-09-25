import {projectServiceGraph} from '../analysis-graph.mjs';
import {displayFreshness,runtimeRows} from '../runtime-view.mjs';
const {ref,computed,onMounted,onUnmounted}=Vue;
export default {
  props:['snapshot','selected','traffic','runtime'], emits:['select','runtime'],
  setup(props) {
    const query=ref('');
    const graph=computed(()=>projectServiceGraph(props.snapshot,query.value));
    const observed=edge=>props.traffic?.edges.some(e=>e.observed&&e.source===edge.source&&e.target===edge.target&&e.protocol===edge.protocol)??false;
    const now=ref(Date.now()); let timer;
    onMounted(()=>{timer=setInterval(()=>{now.value=Date.now();},30000);});
    onUnmounted(()=>clearInterval(timer));
    const runtimeMap=computed(()=>new Map(runtimeRows(props.runtime).filter(r=>r.finding.instanceId).map(r=>[r.finding.instanceId,r])));
    const badge=id=>{const row=runtimeMap.value.get(id); if(!row)return null; const f=displayFreshness(row.report,row.finding,now.value);return f!=='fresh'?f:row.finding.presence==='present'?row.finding.specAlignment:row.finding.presence;};
    return {query,graph,observed,badge};
  },
  template:`<section class="service-map" aria-label="Analyzed service relationships">
    <div class="service-map-heading"><div><div class="eyebrow">SERVICE RELATIONSHIPS</div><h2>{{snapshot.environment}} architecture</h2></div><span class="analysis-status enabled">{{graph.edges.length}} connections</span></div>
    <label class="graph-search">⌕ <input v-model="query" aria-label="Search analyzed relationships" placeholder="Find a service or client"></label>
    <div class="service-map-scroll"><svg :viewBox="'0 0 '+graph.width+' '+graph.height" role="group" aria-label="Service dependency graph">
      <defs><marker id="analysis-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9881d3"/></marker></defs>
      <g v-for="edge in graph.edges" :key="edge.id" class="analyzed-edge" :class="{selected:edge.candidateId===selected,conflicting:edge.consistency==='conflicting',observed:observed(edge)}" role="button" tabindex="0" :aria-label="edge.source+' to '+edge.target+' via '+edge.name" :aria-pressed="edge.candidateId===selected" @click="$emit('select',edge.candidateId)" @keydown.enter="$emit('select',edge.candidateId)" @keydown.space.prevent="$emit('select',edge.candidateId)">
        <path :d="edge.path" class="edge-hit"/><path :d="edge.path" class="edge-line" marker-end="url(#analysis-arrow)"/>
        <rect :x="edge.labelX-67" :y="edge.labelY-15" width="134" height="30" rx="15"/>
        <text :x="edge.labelX" :y="edge.labelY+4" text-anchor="middle">{{edge.name}} · {{edge.protocol}}</text><title>{{observed(edge)?'Traffic observed for this workload pair and protocol; does not identify the source method':edge.consistency==='conflicting'?'Conflicting evidence — inspect this connection':'Select to inspect supporting evidence'}}</title>
      </g>
      <g v-for="node in graph.nodes" :key="node.id" class="analyzed-node" :class="node.kind" :transform="'translate('+node.x+','+(node.y-34)+')'"><rect width="180" height="68" rx="12"/><text x="16" y="23" class="node-kind">{{node.project ? node.project.toUpperCase()+' · INSTANCE' : node.kind.toUpperCase()}}</text><text x="16" y="47">{{node.id.length>21?node.id.slice(0,19)+'…':node.id}}</text><title>{{node.id}}{{node.instance ? ' · '+node.instance.service+' · '+node.instance.scope.cluster+'/'+node.instance.scope.namespace : ''}}</title><g v-if="badge(node.id)" class="runtime-badge" role="button" tabindex="0" :aria-label="'Inspect runtime '+node.id" @click="$emit('runtime',node.id)" @keydown.enter="$emit('runtime',node.id)" @keydown.space.prevent="$emit('runtime',node.id)"><rect x="86" y="-15" width="90" height="23" rx="10"/><text x="131" y="1" text-anchor="middle">{{badge(node.id)}}</text></g></g>
    </svg></div>
    <p v-if="!graph.edges.length" class="graph-empty">No resolved connections in this view. Missing edges are not proof of no dependency.</p>
    <div class="graph-legend"><span>→ Resolved source/config dependency</span><span>Gateway ≠ inferred backend route</span></div>
    <p v-if="traffic" class="traffic-graph-note">Green = observed workload relationship in {{traffic.simulation?'synthetic':'imported'}} capture ending {{traffic.window.end}}. See Traffic evidence for observed-only relationships and unresolved identities.</p>
    <div class="graph-excluded"><h3>Not drawn as connections <span>{{graph.excluded.length}}</span></h3><p>Disabled and unresolved candidates keep their evidence.</p><button v-for="c in graph.excluded" :key="c.id" :aria-label="'Inspect excluded '+c.name" @click="$emit('select',c.id)"><strong>{{c.name}}</strong><span class="analysis-status" :class="c.eligibility">{{c.eligibility==='enabled'?c.targetResolution:c.eligibility}}</span><small>{{c.reasons[0]}}</small></button></div>
  </section>`
};
