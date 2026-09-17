import {projectServiceGraph} from '../analysis-graph.mjs';
const {ref,computed}=Vue;
export default {
  props:['snapshot','selected'], emits:['select'],
  setup(props) {
    const query=ref('');
    const graph=computed(()=>projectServiceGraph(props.snapshot,query.value));
    return {query,graph};
  },
  template:`<section class="service-map" aria-label="Analyzed service relationships">
    <div class="service-map-heading"><div><div class="eyebrow">SERVICE RELATIONSHIPS</div><h2>{{snapshot.environment}} architecture</h2></div><span class="analysis-status enabled">{{graph.edges.length}} connections</span></div>
    <label class="graph-search">⌕ <input v-model="query" aria-label="Search analyzed relationships" placeholder="Find a service or client"></label>
    <div class="service-map-scroll"><svg :viewBox="'0 0 '+graph.width+' '+graph.height" role="group" aria-label="Service dependency graph">
      <defs><marker id="analysis-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9881d3"/></marker></defs>
      <g v-for="edge in graph.edges" :key="edge.id" class="analyzed-edge" :class="{selected:edge.candidateId===selected,conflicting:edge.consistency==='conflicting'}" role="button" tabindex="0" :aria-label="edge.source+' to '+edge.target+' via '+edge.name" :aria-pressed="edge.candidateId===selected" @click="$emit('select',edge.candidateId)" @keydown.enter="$emit('select',edge.candidateId)" @keydown.space.prevent="$emit('select',edge.candidateId)">
        <path :d="edge.path" class="edge-hit"/><path :d="edge.path" class="edge-line" marker-end="url(#analysis-arrow)"/>
        <rect :x="edge.labelX-67" :y="edge.labelY-15" width="134" height="30" rx="15"/>
        <text :x="edge.labelX" :y="edge.labelY+4" text-anchor="middle">{{edge.name}} · {{edge.protocol}}</text><title>{{edge.consistency==='conflicting'?'Conflicting evidence — inspect this connection':'Select to inspect supporting evidence'}}</title>
      </g>
      <g v-for="node in graph.nodes" :key="node.id" class="analyzed-node" :class="node.kind" :transform="'translate('+node.x+','+(node.y-34)+')'"><rect width="180" height="68" rx="12"/><text x="16" y="23" class="node-kind">{{node.kind.toUpperCase()}}</text><text x="16" y="47">{{node.id.length>21?node.id.slice(0,19)+'…':node.id}}</text><title>{{node.id}}</title></g>
    </svg></div>
    <p v-if="!graph.edges.length" class="graph-empty">No resolved connections in this view. Missing edges are not proof of no dependency.</p>
    <div class="graph-legend"><span>→ Resolved source/config dependency</span><span>Gateway ≠ inferred backend route</span></div>
    <div class="graph-excluded"><h3>Not drawn as connections <span>{{graph.excluded.length}}</span></h3><p>Disabled and unresolved candidates keep their evidence.</p><button v-for="c in graph.excluded" :key="c.id" :aria-label="'Inspect excluded '+c.name" @click="$emit('select',c.id)"><strong>{{c.name}}</strong><span class="analysis-status" :class="c.eligibility">{{c.eligibility==='enabled'?c.targetResolution:c.eligibility}}</span><small>{{c.reasons[0]}}</small></button></div>
  </section>`
};
