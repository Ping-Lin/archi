const { ref, computed, watch } = Vue;
export default {
  props: ["report"],
  setup(props) {
    const selected = ref(null);
    watch(
      () => props.report,
      () => {
        selected.value = null;
      },
    );
    const edge = computed(() =>
      props.report?.edges.find(
        (e) =>
          JSON.stringify([e.source, e.target, e.protocol]) === selected.value,
      ),
    );
    const evidence = computed(
      () =>
        props.report?.evidence.filter((e) =>
          edge.value?.evidenceIds.includes(e.id),
        ) ?? [],
    );
    const number = (value) =>
      value === null || value === undefined
        ? "—"
        : Number(value.toFixed(3)).toLocaleString();
    return { selected, edge, evidence, number };
  },
  template: `<section class="traffic-panel" aria-label="Traffic reconciliation">
    <div class="inventory-intro"><div class="eyebrow">OBSERVATION LAYER</div><h2>Configured. Observed. Explained.</h2>
      <p>Traffic evidence does not verify deployed source revisions. Missing traffic is not proof of no dependency.</p></div>
    <p v-if="!report" class="graph-empty">No traffic capture for this environment. Import a bundle with npm run traffic.</p>
    <template v-else>
      <div class="traffic-window"><strong>{{report.simulation?'SYNTHETIC CAPTURE':'IMPORTED CAPTURE'}} · not live</strong><span>{{report.window.start}} → {{report.window.end}}</span></div>
      <div class="coverage-grid"><div v-for="s in report.sources" :key="s.id"><strong>{{s.adapter}} · {{s.coverage}}</strong><p>{{s.note}}</p><small>Sampling: {{s.sampling}} · coverage supplied by capture author</small></div></div>
      <div class="analysis-table-wrap"><table class="analysis-table traffic-table"><thead><tr><th>Relationship</th><th>Reconciliation</th><th>Request increase*</th><th>Avg RPS*</th><th>Error rate*</th><th>Trace samples</th></tr></thead>
        <tbody><tr v-for="e in report.edges" :key="JSON.stringify([e.source,e.target,e.protocol])"><td><button class="traffic-select" @click="selected=JSON.stringify([e.source,e.target,e.protocol])">{{e.source}} → {{e.target}}</button><small>{{e.protocol}} · {{e.staticDependencyIds.length}} static dependencies</small></td><td><span class="analysis-status" :class="e.status==='supported'?'enabled':'unknown'">{{e.status}}</span></td><td>{{number(e.requestCount)}}</td><td>{{number(e.rps)}}</td><td>{{e.errorRate===null?'—':number(e.errorRate*100)+'%'}}</td><td>{{e.traceSamples.length}}</td></tr></tbody></table></div>
      <p class="traffic-caveat">* Destination-proxy perspective; Prometheus increase estimates may be fractional. HTTP errors = 5xx; gRPC errors = nonzero status. Unknown statuses suppress the error rate. Trace samples are never added to request counts.</p>
      <div v-if="edge" class="traffic-evidence"><h3>{{edge.source}} → {{edge.target}} · evidence</h3><p>{{edge.status}} · source-to-release correspondence remains unverified.</p><p v-if="!evidence.length">No matching observations in this capture.</p><details v-for="e in evidence" :key="e.id"><summary>{{e.adapter}} · {{e.source}} · inspect record</summary><pre>{{JSON.stringify(e.reference,null,2)}}</pre></details><p v-for="s in edge.traceSamples" :key="s.id">Server span duration: {{number(s.durationMs)}} ms · sample only, not population latency</p></div>
      <details class="traffic-evidence"><summary>Unresolved identities · {{report.unresolved.length}}</summary><div v-for="o in report.unresolved" :key="o.id"><strong>{{o.source.status}} → {{o.target.status}} · {{o.protocol}}</strong><pre>{{JSON.stringify({source:o.source,target:o.target},null,2)}}</pre></div></details>
      <details class="traffic-evidence"><summary>Capture diagnostics · {{report.diagnostics.length}}</summary><pre>{{JSON.stringify(report.diagnostics,null,2)}}</pre></details>
      <p class="traffic-caveat">Capture hash: <code>{{report.inputHash}}</code></p>
    </template>
  </section>`,
};
