import RuntimePanel from "./RuntimePanel.mjs";
import { verifyDisplayBundle, expectationRows } from "../acceptance-view.mjs";
import { compareRuntime } from "../runtime-comparison.mjs";
const { ref, computed, watch, onMounted } = Vue;
export default {
  components: { RuntimePanel },
  setup() {
    const bundle = ref(null), selected = ref(""), error = ref(""), loading = ref(false),
      tab = ref("scenario"), beforeId = ref(""), showUnchanged = ref(false);
    let loadId = 0;
    async function install(raw, id = ++loadId) {
      if (id !== loadId) return;
      loading.value = true; error.value = "";
      try {
        if (new TextEncoder().encode(raw).length > 32 * 1024 * 1024) throw Error("Bundle exceeds 32 MiB");
        const value = await verifyDisplayBundle(JSON.parse(raw));
        if (id !== loadId) return;
        bundle.value = value; selected.value = value.cases[0].id; beforeId.value = "";
      } catch (e) { if (id === loadId) { bundle.value = null; error.value = e.message; } }
      finally { if (id === loadId) loading.value = false; }
    }
    onMounted(async () => {
      const id = ++loadId;
      try {
        const r = await fetch("./acceptance.json");
        if (!r.ok) throw Error("Create a scenario bundle or open an existing acceptance JSON file.");
        await install(await r.text(), id);
      } catch (e) { if (id === loadId) error.value = e.message; }
    });
    async function openFile(event) {
      const file = event.target.files[0]; if (!file) return;
      const id = ++loadId;
      try {
        if (file.size > 32 * 1024 * 1024) throw Error("Bundle exceeds 32 MiB");
        await install(await file.text(), id);
      } catch (e) { if (id === loadId) { bundle.value = null; loading.value = false; error.value = e.message; } }
      finally { event.target.value = ""; }
    }
    const current = computed(() => bundle.value?.cases.find((c) => c.id === selected.value));
    const comparable = computed(() => bundle.value?.cases.filter((c) => c.id !== selected.value &&
      c.report.environment === current.value?.report.environment && c.report.cluster === current.value?.report.cluster) ?? []);
    watch(selected, () => {
      const prior = comparable.value.filter((c) => Date.parse(c.report.finishedAt) <= Date.parse(current.value.report.finishedAt));
      if (!comparable.value.some((c) => c.id === beforeId.value)) beforeId.value = prior.at(-1)?.id ?? comparable.value[0]?.id ?? "";
    });
    const previous = computed(() => bundle.value?.cases.find((c) => c.id === beforeId.value));
    const comparison = computed(() => previous.value && current.value
      ? compareRuntime(previous.value.report, current.value.report) : []);
    const rows = computed(() => comparison.value.filter((r) => showUnchanged.value || r.changes.length));
    const expectations = computed(() => current.value ? expectationRows(current.value) : []);
    const overlay = computed(() => ({ reports: [current.value.report] }));
    function download() {
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle.value, null, 2) + "\n"], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = "archi-acceptance.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return { bundle, selected, error, loading, tab, beforeId, showUnchanged, current,
      comparable, previous, comparison, rows, expectations, overlay, openFile, download };
  },
  template: `<div class="acceptance-workspace">
    <header class="topbar"><a class="brand" href="./"><img src="./mark.svg" alt="">archi.</a><div class="breadcrumbs"><a href="./?view=analysis">Project analysis</a><span>/</span><strong>Deployment scenarios</strong></div><span class="fixture-badge">{{bundle?.simulation===false?'Imported observations':'Synthetic scenarios'}}</span></header>
    <main><div class="page-heading"><div><div class="eyebrow">REPLAY · COMPARE · EXPLAIN</div><h1>Every deployment has a story.</h1><p>Explore independent releases without treating version differences as errors.</p></div><div class="acceptance-actions"><label class="secondary-button">Open bundle<input class="sr-only" aria-label="Open acceptance bundle" type="file" accept=".json,application/json" @change="openFile"></label><button v-if="bundle" class="secondary-button" @click="download">Export bundle</button></div></div>
      <p v-if="loading" role="status">Checking bundle integrity…</p><div v-if="error" class="analysis-empty" role="alert"><h2>Bundle unavailable</h2><p>{{error}}</p><code>mkdir -p artifacts/acceptance<br>npm run runtime:acceptance -- --scenarios --out artifacts/acceptance/bundle.json</code></div>
      <template v-if="current && !loading"><div class="acceptance-notice"><strong>{{bundle.mode==='scenarios'?'Authored CD simulation':'Imported capture collection'}}</strong><p>{{bundle.mode==='scenarios'?'These phases illustrate CD behavior; no pipeline or cluster deployment was executed.':'Captures retain their source analysis. No independent acceptance oracle was supplied.'}} Hash integrity checked. Full deterministic replay is available through the verification command.</p></div>
        <div class="acceptance-controls"><label>Phase / environment<select aria-label="Scenario case" v-model="selected"><option v-for="c in bundle.cases" :value="c.id">{{c.id}} · {{c.title}}</option></select></label><div><span class="eyebrow">SELECTED CAPTURE</span><h2>{{current.title}}</h2><p>{{current.report.environment}} / {{current.report.cluster}} · {{current.report.finishedAt}}</p></div></div>
        <nav class="analysis-tabs" aria-label="Acceptance views"><button :class="{active:tab==='scenario'}" @click="tab='scenario'">Scenario details</button><button :class="{active:tab==='compare'}" @click="tab='compare'">Compare captures</button></nav>
        <section v-if="tab==='scenario'" class="analysis-panel"><div class="inventory-intro"><h2>Expected and observed interpretation</h2><p>Dimensions: image references · rollout · assessment. An expected failure can be a passing scenario.</p></div><div class="analysis-table-wrap"><table class="analysis-table expectation-table"><thead><tr><th>Service</th><th>Independent expectation</th><th>Actual interpretation</th><th>Scenario result</th></tr></thead><tbody><tr v-for="r in expectations"><td>{{r.id}}</td><td>{{r.expected?.join(' · ')??'Not provided'}}</td><td>{{r.actual?.join(' · ')??'No finding'}}</td><td>{{r.result}}</td></tr></tbody></table></div><RuntimePanel :key="current.id" :overlay="overlay" selected="orders"/></section>
        <section v-else class="analysis-panel"><div class="inventory-intro"><h2>Captured changes, without inferred causes.</h2><p>Comparison is limited to one environment and cluster. A missing finding does not prove deletion; different UIDs indicate resource recreation.</p><label>Compare from <select aria-label="Before capture" v-model="beforeId"><option v-for="c in comparable" :value="c.id">{{c.id}} · {{c.report.finishedAt}}</option></select></label><p v-if="previous">From {{previous.report.finishedAt}} → {{current.report.finishedAt}}. Baseline {{previous.snapshot.contentHash===current.snapshot.contentHash?'unchanged':'changed'}}.</p><label><input type="checkbox" v-model="showUnchanged"> Show unchanged workloads</label></div>
          <p v-if="!previous" class="analysis-empty">Add another capture from the same environment and cluster to compare.</p><p v-else-if="!rows.length" class="analysis-empty">No changes in the compared dimensions.</p><div class="analysis-table-wrap" v-else><table class="analysis-table capture-comparison"><thead><tr><th>Workload</th><th>Changes</th><th>Before</th><th>After</th></tr></thead><tbody><tr v-for="r in rows"><td><code>{{r.key}}</code><small>{{r.identity}} · {{r.coverage}}</small></td><td>{{r.changes.join(', ')||'unchanged'}}</td><td><pre>{{JSON.stringify(r.before,null,2)}}</pre></td><td><pre>{{JSON.stringify(r.after,null,2)}}</pre></td></tr></tbody></table></div></section>
        <details class="revision-panel"><summary>Reproduction and provenance</summary><p>Rule: {{bundle.engine.ruleVersion}} · Engine source SHA-256: {{bundle.engine.sourceHash}}</p><p>Bundle SHA-256: {{bundle.contentHash}}</p><code>npm run runtime:acceptance -- --verify PATH_TO_BUNDLE.json</code><p>Use the same Archi code and package-lock.json, Node 22+ and installed dependencies. Runtime replay needs no Helm, Git repositories, network or cluster. Hashes identify bytes; they do not authenticate their source.</p><p>Source-to-release correspondence: {{current.report.releaseCorrespondence}}</p></details>
      </template>
    </main></div>`,
};
