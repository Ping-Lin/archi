import { displayFreshness } from '../runtime-view.mjs';
const { computed, ref, onMounted, onUnmounted } = Vue;
export default {
  props: ['analysis', 'snapshot', 'environment'],
  emits: ['runtime'],
  setup(props) {
    const now = ref(Date.now());
    let timer;
    // Display clock only: never fetch data or start collection.
    onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 30000); });
    onUnmounted(() => clearInterval(timer));
    const reports = computed(() => props.analysis.runtime?.[props.environment]?.reports ?? []);
    const traffic = computed(() => props.analysis.traffic?.[props.environment]);
    const freshness = (report) => {
      const states = report.findings.map(f => displayFreshness(report, f, now.value));
      return states.includes('stale') ? 'stale' : !states.length || states.includes('unknown') ? 'unknown' : 'fresh';
    };
    return { reports, traffic, freshness };
  },
  template: `<section class="data-context" aria-label="Data sources and timestamps">
    <div class="data-context-heading"><strong>{{environment}} · {{analysis.simulation?'Synthetic inputs':'Real-input analysis'}}</strong><span>Stored evidence · not live · no background refresh</span></div>
    <div class="data-context-grid">
      <div><h3>Source / Helm</h3><p>Selected repository baseline</p><p>Analysis assessed at <time>{{analysis.run.assessedAt}}</time></p><small>This is not a deployment capture time. Source revisions do not prove deployed versions.</small></div>
      <div><h3>Runtime</h3><p v-if="!reports.length">No stored capture · deployment unknown</p><div v-for="r in reports" :key="r.cluster" class="data-capture"><strong>{{r.cluster}} · {{r.simulation?'synthetic':'imported'}} · {{freshness(r)}}</strong><p>Captured <time>{{r.startedAt}}</time> → <time>{{r.finishedAt}}</time></p><small>Freshness uses report TTL {{r.ttlSeconds}}s; it does not establish health or collection completeness.</small></div><button class="text-button" @click="$emit('runtime')">Open runtime inventory</button></div>
      <div><h3>Traffic</h3><template v-if="traffic"><p>{{traffic.simulation?'Synthetic':'Imported'}} observation window</p><p><time>{{traffic.window.start}}</time> → <time>{{traffic.window.end}}</time></p><small>No freshness policy is defined; do not assume this window is current.</small></template><p v-else>No stored traffic capture · traffic unknown</p></div>
    </div>
  </section>`,
};
