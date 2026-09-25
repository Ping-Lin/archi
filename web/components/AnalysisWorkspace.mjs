import AnalysisGraph from './AnalysisGraph.mjs';
import TrafficPanel from './TrafficPanel.mjs';
import RuntimePanel from './RuntimePanel.mjs';
const { ref, computed, onMounted } = Vue;
export default {
  components: {AnalysisGraph,TrafficPanel,RuntimePanel},
  setup() {
    const data = ref(null),
      error = ref(""),
      environment = ref("dev"),
      selected = ref("clientA"),
      tab = ref("graph"), runtimeSelected = ref(null);
    onMounted(async () => {
      try {
        const r = await fetch("./analysis.json");
        if (!r.ok)
          throw new Error("Run npm run analyze, then refresh this page.");
        data.value = await r.json();
        environment.value = data.value.snapshots[0].environment;
      } catch (e) {
        error.value = e.message;
      }
    });
    const snapshot = computed(() =>
      data.value?.snapshots.find((s) => s.environment === environment.value),
    );
    const candidate = computed(
      () =>
        snapshot.value?.candidates.find((c) => c.id === selected.value || c.name === selected.value) ??
        snapshot.value?.candidates[0],
    );
    const resolution = computed(() =>
      snapshot.value?.resolutions.find(
        (r) => r.id === candidate.value?.resolutionId,
      ),
    );
    const sourceInstance = computed(() => snapshot.value?.instances?.find(i=>i.id===candidate.value?.source));
    const sourceRevisions = computed(() => {
      const source=snapshot.value?.services?.find(s=>s.id===candidate.value?.sourceService)?.source;
      const repos=[...new Set(source?.files.map(f=>f.repository)??[])];
      return repos.map(repository=>({repository,revision:snapshot.value.inputLock.revisionVector[repository]}));
    });
    const facts = computed(
      () =>
        resolution.value?.inputFactIds.map((id) =>
          snapshot.value.facts.find((f) => f.id === id),
        ) ?? [],
    );
    const evidenceFor = (fact) =>
      fact.evidenceIds.map((id) =>
        snapshot.value.evidence.find((e) => e.id === id),
      );
    const assessment = computed(() =>
      data.value?.assessments.find((a) => a.environment === environment.value),
    );
    const freshness = computed(
      () =>
        assessment.value?.candidates.find((c) => c.id === candidate.value?.id)
          ?.freshness ?? "unknown",
    );
    const chain = computed(() =>
      facts.value.filter((f) =>
        ["property.value", "resource.present", "runtime.target"].includes(
          f.predicate,
        ),
      ),
    );
    const compareRows = computed(() => [...new Map(
      (data.value?.snapshots.flatMap(s => s.candidates) ?? []).map(c => [
        JSON.stringify([c.source,c.name]), {source:c.source,name:c.name},
      ]),
    ).values()]);
    function exportData() {
      const traffic=data.value.traffic?.[environment.value];
      const runtime=data.value.runtime?.[environment.value];
      const exported=traffic||runtime?{schemaVersion:'archi/inspection-v1alpha1',snapshot:snapshot.value,...(traffic?{traffic}:{}),...(runtime?{runtime}:{})}:snapshot.value;
      const blob = new Blob([JSON.stringify(exported, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `archi-analysis-${environment.value}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const label = (value) => value?.replaceAll("-", " ") ?? "unknown";
    return {
      data,
      error,
      environment,
      selected,
      tab,
      snapshot,
      candidate,
      resolution,
      sourceInstance,
      sourceRevisions,
      facts,
      evidenceFor,
      assessment,
      freshness,
      chain,
      compareRows,
      exportData,
      runtimeSelected,
      label,
    };
  },
  template: `<div class="workspace analysis-workspace">
    <aside class="sidebar"><a class="brand" href="./"><img src="./mark.svg" alt=""><span>archi<span class="brand-dot">.</span></span></a>
      <div class="workspace-switch"><span class="workspace-avatar">E</span><div>Evidence lab<span>Analysis workspace · v2</span></div></div>
      <div class="nav-label">WORKSPACE</div><a class="nav-item" href="./">◈ &nbsp; Architecture demo</a><button class="nav-item active" @click="tab='evidence'">⌘ &nbsp; Evidence explorer</button>
      <div class="nav-label projects-label">ENVIRONMENTS</div><button v-for="s in data?.snapshots??[]" :key="s.environment" class="project-item" :class="{chosen:environment===s.environment}" @click="environment=s.environment"><i class="dot"></i>{{s.environment}}<span>{{s.dependencies.length}} edges</span></button>
      <div class="sidebar-bottom"><div class="sandbox-note"><span class="sandbox-icon">◇</span><strong>Know why it connects.</strong><p>Every conclusion keeps its evidence. Unknowns stay visible.</p></div><div class="profile"><span class="profile-avatar">P</span><div>Ping’s workspace<small>{{data?.simulation===false?'Source analysis':'Synthetic'}} · read only</small></div></div></div>
    </aside>
    <div class="main-shell"><header class="topbar"><div class="breadcrumbs">Workspace <span>/</span> <strong>Evidence lab</strong></div><span class="fixture-badge">{{data?.simulation===false?'Selected source baseline':'Synthetic source analysis'}}</span></header>
      <main v-if="error" class="analysis-empty"><h1>Start with the evidence.</h1><p>{{error}}</p><code>npm ci && npm run analyze</code><p>Helm v3.17.3 is required. The original demo remains available.</p><a href="./">Open architecture demo →</a></main>
      <main v-else-if="snapshot"><div class="page-heading"><div><div class="eyebrow">EXPLAINABLE ARCHITECTURE</div><h1>Follow the evidence.</h1><p>Source to configuration to connection. One environment at a time.</p></div><button class="secondary-button" @click="exportData">↥ Export analysis</button></div>
        <div class="analysis-scope"><div><span class="scope-label">ANALYZING</span><strong>{{data.name}}</strong><span class="scope-divider">/</span><label><span class="sr-only">Analysis environment</span><select aria-label="Analysis environment" v-model="environment"><option v-for="s in data.snapshots" :value="s.environment">{{s.environment}}</option></select></label></div><span>Local Helm render · source/config conclusions</span></div>
        <div class="summary-grid"><div class="summary-card"><span class="summary-icon purple">↗</span><div><strong>{{snapshot.dependencies.length}}</strong><span>Resolved connections</span></div></div><div class="summary-card"><span class="summary-icon blue">◈</span><div><strong>{{snapshot.candidates.length}}</strong><span>Source candidates</span></div></div><div class="summary-card"><span class="summary-icon green">⊘</span><div><strong>{{snapshot.candidates.filter(c=>c.eligibility==='disabled').length}}</strong><span>Explicitly disabled</span></div></div><div class="summary-card"><span class="summary-icon amber">?</span><div><strong>{{snapshot.candidates.filter(c=>c.eligibility==='unknown'||c.targetResolution!=='unique').length}}</strong><span>Need investigation</span></div></div></div>
        <div class="analysis-notice"><span>◷</span><div><strong>{{data.runtime?.[environment]?'Deployment capture available · see Runtime inventory':assessment.observationFreshness==='stale'?'Observation is stale':snapshot.observation.coverage==='unavailable'?(data.traffic?.[environment]?'Traffic capture available · deployment unverified':'No deployment or runtime input'):'Dated fixture observations'}}</strong><span> {{snapshot.observation.collectedAt??'Source/config analysis is available independently.'}} · Release correspondence is unverified.</span></div></div>
        <details v-if="snapshot.inputLock.revisionVector" class="revision-panel"><summary>Pinned repositories · {{Object.keys(snapshot.inputLock.revisionVector).length}} independent revisions</summary><p>Source/config inputs only. These commits do not prove deployed release versions.</p><div v-for="(revision,repository) in snapshot.inputLock.revisionVector" :key="repository"><strong>{{repository}}</strong><code>{{revision}}</code></div></details><section class="analysis-panel"><div class="analysis-tabs" role="tablist" aria-label="Analysis views"><button role="tab" :aria-selected="tab==='graph'" :class="{active:tab==='graph'}" @click="tab='graph'">Service graph</button><button role="tab" :aria-selected="tab==='evidence'" :class="{active:tab==='evidence'}" @click="tab='evidence'">Connections & evidence</button><button role="tab" :aria-selected="tab==='resources'" :class="{active:tab==='resources'}" @click="tab='resources'">Resource inventory</button><button role="tab" :aria-selected="tab==='compare'" :class="{active:tab==='compare'}" @click="tab='compare'">Compare environments</button><button role="tab" :aria-selected="tab==='traffic'" :class="{active:tab==='traffic'}" @click="tab='traffic'">Traffic evidence</button><button role="tab" :aria-selected="tab==='runtime'" :class="{active:tab==='runtime'}" @click="tab='runtime'">Runtime inventory</button></div>
          <div v-if="tab==='evidence'||tab==='graph'" class="analysis-split" :class="{'graph-split':tab==='graph'}"><AnalysisGraph v-if="tab==='graph'" :snapshot="snapshot" :traffic="data.traffic?.[environment]" :runtime="data.runtime?.[environment]" @runtime="runtimeSelected=$event;tab='runtime'" :selected="candidate?.id" @select="selected=$event"/><div v-else class="candidate-list"><div class="analysis-section-label">CLIENT CANDIDATES <span>{{snapshot.candidates.length}}</span></div><button v-for="c in snapshot.candidates" :key="c.id" class="candidate-card" :class="{selected:c.id===candidate?.id}" @click="selected=c.id"><div><strong>{{c.name}}</strong><span class="analysis-status" :class="c.eligibility">{{c.eligibility}}</span></div><p>{{c.source}} <span>→</span> {{c.target??'unresolved target'}}</p><small>{{c.key??'Unsupported configuration pattern'}}</small><span class="candidate-foot">{{c.eligibility==='disabled'?'Excluded by configuration':c.eligibility==='unknown'?'Registration not established':c.targetResolution==='unique'?'Included in architecture':'Target needs resolution'}} <b>↗</b></span></button></div>
            <div v-if="candidate" class="evidence-detail"><div class="detail-heading"><div><div class="eyebrow">CONNECTION EXPLANATION</div><h2>{{candidate.name}}</h2></div><span class="analysis-status" :class="candidate.eligibility">{{candidate.eligibility==='enabled'&&candidate.targetResolution==='unique'?'Included':label(candidate.eligibility)}}</span></div>
              <div class="connection-strip"><div><small>SOURCE</small><strong>{{candidate.source}}</strong></div><span>→</span><div><small>{{candidate.targetResolution==='unique'?'RESOLVED TARGET':'TARGET'}}</small><strong>{{candidate.target??candidate.targetResolution}}</strong></div></div>
              <div v-if="sourceInstance" class="binding-detail"><strong>{{candidate.sourceProject}} / {{candidate.sourceService}}</strong><p>Instance {{sourceInstance.id}} · {{sourceInstance.scope.cluster}} / {{sourceInstance.scope.namespace}} / {{sourceInstance.scope.name}}</p><p v-for="r in sourceRevisions">Source {{r.repository}} <code>{{r.revision}}</code></p><p v-if="candidate.targetService">Target {{candidate.targetProject}} / {{candidate.targetService}} · instance {{candidate.target}}</p></div><div class="dimension-grid"><div><span>Target mapping</span><strong>{{candidate.targetResolution}}</strong></div><div><span>Runtime evidence</span><strong>{{candidate.runtimeSupport}}<small v-if="candidate.runtimeSupport==='observed'"> · {{freshness}}</small></strong></div><div><span>Consistency</span><strong>{{candidate.consistency}}</strong></div></div>
              <h3>Why this result</h3><ul class="reason-list"><li v-for="reason in candidate.reasons">{{reason}}</li></ul>
              <h3>Evidence trail <span>{{chain.length+1}} steps</span></h3><ol class="evidence-timeline"><li><span class="step-marker">1</span><div><strong>Source candidate</strong><p>{{candidate.file}}:{{candidate.line}}</p><code>{{candidate.key??'No supported literal key'}}</code></div></li><li v-for="(fact,i) in chain" :key="fact.id"><span class="step-marker">{{i+2}}</span><div><strong>{{fact.predicate==='property.value'?'Configuration value':fact.predicate==='resource.present'?'Rendered target resource':'Runtime observation'}}</strong><p v-for="e in evidenceFor(fact)">{{e.locator}}</p><code>{{fact.value.value??fact.value.name??fact.value.target}}</code><small v-if="fact.predicate==='property.value'">Precedence {{fact.value.precedence}} · later supported source wins</small></div></li></ol>
              <details class="fact-details"><summary>Inspect all input facts ({{facts.length}})</summary><div v-for="fact in facts" :key="fact.id"><strong>{{fact.predicate}}</strong><pre>{{JSON.stringify(fact.value,null,2)}}</pre><p v-for="e in evidenceFor(fact)">{{e.type}} · {{e.locator}}<br><small>SHA-256 {{e.contentHash}}</small></p></div></details>
              <div class="resolution-footer"><span>{{resolution.rule}} · {{resolution.version}}</span><code>{{resolution.id}}</code></div>
            </div><div v-else class="analysis-empty">No supported client candidates were extracted. Inspect diagnostics below.</div>
          </div>
          <RuntimePanel v-else-if="tab==='runtime'" :overlay="data.runtime?.[environment]" :selected="runtimeSelected"/><TrafficPanel v-else-if="tab==='traffic'" :report="data.traffic?.[environment]"/><div v-else-if="tab==='resources'" class="analysis-table-wrap"><div class="inventory-intro"><h2>Presence is not health.</h2><p>Within the selected render scopes. Comparison covers container images only; scaling ownership and release correspondence are unknown.</p></div><table class="analysis-table"><thead><tr><th>Resource</th><th>Presence</th><th>Supported fields</th><th>Observed health</th></tr></thead><tbody><tr v-for="r in snapshot.resourceComparisons" :key="JSON.stringify([r.caller,r.key])"><td><strong>{{r.name}}</strong><small>{{r.caller ? r.caller+' · ' : ''}}{{r.kind}} · {{r.uid??'No observed UID'}}</small></td><td>{{label(r.presence)}}</td><td>{{label(r.comparison)}}</td><td><span class="analysis-status" :class="r.health==='ready'?'enabled':'unknown'">{{r.health}}</span><small v-if="r.replicas">{{r.replicas.ready??'?'}} / {{r.replicas.live??'?'}} ready</small></td></tr></tbody></table></div>
          <div v-else class="analysis-table-wrap"><div class="inventory-intro"><h2>Independent inputs. Different outcomes.</h2><p>Dev observations never confirm production dependencies. Disabled candidates keep their explanation.</p></div><table class="analysis-table"><thead><tr><th>Candidate</th><th v-for="s in data.snapshots">{{s.environment}}</th></tr></thead><tbody><tr v-for="row in compareRows"><td><strong>{{row.source}} / {{row.name}}</strong></td><td v-for="s in data.snapshots"><template v-for="c in s.candidates.filter(c=>c.source===row.source&&c.name===row.name)"><span class="analysis-status" :class="c.eligibility">{{c.eligibility}}</span><small>{{c.target??c.targetResolution}} · runtime {{c.runtimeSupport}}</small></template><small v-if="!s.candidates.some(c=>c.source===row.source&&c.name===row.name)">Not discovered within analyzed scope</small></td></tr></tbody></table><div class="snapshot-hashes"><div v-for="s in data.snapshots"><strong>{{s.environment}}</strong><code>{{s.contentHash}}</code></div></div></div>
          <footer class="analysis-panel-footer"><span>◇ {{snapshot.evidence.length}} evidence records · {{snapshot.facts.length}} facts</span><span>Assessment {{data.run.assessedAt}}</span></footer>
        </section>
        <details class="analysis-diagnostics"><summary>Analysis coverage & diagnostics <span>{{snapshot.diagnostics.length}} items</span></summary><div class="coverage-grid"><div v-for="c in snapshot.coverage"><strong>{{c.caller ? c.caller+' · ' : ''}}{{c.collector}} · {{c.status}}</strong><p>{{c.meaning}}</p></div></div><p v-for="d in snapshot.diagnostics"><code>{{d.code}}</code> {{d.caller ? d.caller+': ' : ''}}{{d.message}}</p><p>Input mode: {{data.run.inputMode}}. SHA-256 locks identify captured bytes. Source commit does not prove the deployed revision.</p></details>
        <div class="page-footer"><span>Explain the connection. Preserve the uncertainty.</span><span>Bounded Spring analysis · imported observations</span></div>
      </main><main v-else><p>Loading evidence…</p></main>
    </div>
  </div>`,
};
