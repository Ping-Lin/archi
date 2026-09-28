export default {
  props: ['candidates', 'selected', 'query', 'filter', 'total'],
  emits: ['select', 'update:query', 'update:filter'],
  template: `<div class="candidate-list">
    <div class="analysis-section-label">CLIENT CANDIDATES <span>{{candidates.length}} / {{total}}</span></div>
    <div class="candidate-controls">
      <label>Find a connection<input type="search" aria-label="Find a connection" :value="query" @input="$emit('update:query',$event.target.value)" placeholder="Client, service, key or reviewer"></label>
      <label>Candidate filter<select aria-label="Candidate filter" :value="filter" @change="$emit('update:filter',$event.target.value)">
        <option value="all">All candidates</option><option value="investigate">Needs investigation</option>
        <option value="ai">All AI candidates</option><option value="unreviewed">AI · awaiting review</option>
        <option value="accepted">AI · accepted</option><option value="rejected">AI · rejected</option>
      </select></label>
      <p role="status">{{candidates.length}} matching candidates. Filters do not change the graph.</p>
    </div>
    <button v-for="c in candidates" :key="c.id" class="candidate-card" :class="{selected:c.id===selected}" :aria-pressed="c.id===selected" @click="$emit('select',c.id)">
      <div><strong>{{c.name}}</strong><span class="analysis-status" :class="c.eligibility">{{c.eligibility}}</span></div>
      <p>{{c.source}} <span>→</span> {{c.target??'unresolved target'}}</p><small>{{c.key??'Unsupported configuration pattern'}}</small>
      <small v-if="c.extraction">AI · {{c.extraction.status}} · {{c.extraction.reviewer??'No declared reviewer'}}</small>
      <span class="candidate-foot">{{c.eligibility==='disabled'?'Excluded by configuration':c.eligibility==='unknown'?'Registration not established':c.targetResolution==='unique'?'Included in architecture':'Target needs resolution'}} <b>↗</b></span>
    </button>
    <p v-if="!candidates.length" class="candidate-controls">No matches. <button class="secondary-button" @click="$emit('update:query','');$emit('update:filter','all')">Clear filters</button></p>
  </div>`,
};
