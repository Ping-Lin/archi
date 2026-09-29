import AnalysisGraph from './AnalysisGraph.mjs';
import CandidateList from './CandidateList.mjs';
import { filterCandidates } from '../candidate-review.mjs';
import TrafficPanel from './TrafficPanel.mjs';
import RuntimePanel from './RuntimePanel.mjs';
import RuntimeRefresh from './RuntimeRefresh.mjs';
import DataContext from './DataContext.mjs';
import AnalysisTabs from './AnalysisTabs.mjs';
import { helpContext } from '../help-context.mjs';
const { ref, computed, onMounted, watchEffect, onUnmounted } = Vue;
export default {
  components: {AnalysisGraph,CandidateList,TrafficPanel,RuntimePanel,RuntimeRefresh,DataContext,AnalysisTabs},
  setup() {
    const data = ref(null),
      error = ref(""),
      environment = ref("dev"),
      selected = ref("clientA"),
      tab = ref("graph"), runtimeSelected = ref(null), candidateQuery = ref(''), candidateFilter = ref('all');
    watchEffect(() => { helpContext.analysis = { loaded: !!data.value, tab: tab.value,
      environment: environment.value, simulation: data.value?.simulation,
      runtime: !!data.value?.runtime?.[environment.value], traffic: !!data.value?.traffic?.[environment.value] }; });
    onUnmounted(() => { helpContext.analysis = null; });
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
    const filteredCandidates = computed(() => filterCandidates(snapshot.value?.candidates ?? [], candidateQuery.value, candidateFilter.value));
    const selectableCandidates = computed(() => tab.value === 'evidence' ? filteredCandidates.value : snapshot.value?.candidates ?? []);
    const candidate = computed(
      () =>
        selectableCandidates.value.find((c) => c.id === selected.value || c.name === selected.value) ??
        selectableCandidates.value[0],
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
    const aiCitations = computed(() => [...new Map(facts.value.flatMap(evidenceFor)
      .filter(e => e?.type === 'ai_source_reference').map(e => [e.id,e])).values()]);
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
      candidateQuery,
      candidateFilter,
      filteredCandidates,
      tab,
      snapshot,
      candidate,
      resolution,
      sourceInstance,
      sourceRevisions,
      facts,
      aiCitations,
      evidenceFor,
      assessment,
      freshness,
      chain,
      placeholderFacts: computed(() => facts.value.filter(f=>f.predicate==='property.placeholder')),
      compareRows,
      exportData,
      runtimeSelected,
      label,
    };
  },
  template: `<div class="workspace analysis-workspace">
    <aside class="sidebar"><a class="brand" href="./"><img src="./mark.svg" alt=""><span>archi<span class="brand-dot">.</span></span></a>
      <div class="workspace-switch"><span class="workspace-avatar">E</span><div>Project analysis<span>Analysis workspace · v2</span></div></div>
      <div class="nav-label">WORKSPACE</div><a class="nav-item" href="./" title="Fictional architecture example">◈ &nbsp; Architecture demo</a><a class="nav-item active" href="./?view=analysis" aria-current="page" title="Selected source and configuration evidence">⌘ &nbsp; Project analysis</a><a class="nav-item" href="./?view=acceptance" title="Offline rollout scenarios and acceptance bundles">⇄ &nbsp; Deployment scenarios</a>
      <div class="nav-label projects-label">ENVIRONMENTS</div><button v-for="s in data?.snapshots??[]" :key="s.environment" class="project-item" :class="{chosen:environment===s.environment}" @click="environment=s.environment"><i class="dot"></i>{{s.environment}}<span>{{s.dependencies.length}} edges</span></button>
      <div class="sidebar-bottom"><div class="sandbox-note"><span class="sandbox-icon">◇</span><strong>Know why it connects.</strong><p>Every conclusion keeps its evidence. Unknowns stay visible.</p></div><div class="profile"><span class="profile-avatar">P</span><div>Ping’s workspace<small>{{data?.simulation===false?'Source analysis':'Synthetic'}} · read only</small></div></div></div>
    </aside>
    <div class="main-shell"><header class="topbar"><div class="breadcrumbs">Workspace <span>/</span> <strong>Project analysis</strong></div><span class="fixture-badge">{{data?.simulation===false?'Selected source baseline':'Synthetic source analysis'}}</span></header>
      <main v-if="error" class="analysis-empty"><h1>Prepare your project analysis.</h1><p>{{error}}</p><ol><li>Install dependencies and Helm v3.17.3.</li><li>Prepare reviewed repository revisions, chart inputs and environment bindings.</li><li>Run system analysis with output in this server's artifacts/analysis directory, then reload this page.</li></ol><p>Static analysis needs no cluster credentials. To learn without project inputs, use the fictional demo or deployment scenarios.</p><p><a href="https://github.com/Ping-Lin/archi/blob/feat/architecture-poc/docs/adoption-guide.zh-TW.md" target="_blank" rel="noopener noreferrer">繁體中文設定指南 ↗</a> · GitHub repository access required.</p><a href="./">Open architecture demo →</a> · <a href="./?view=acceptance">Open deployment scenarios →</a></main>
      <main v-else-if="snapshot"><div class="page-heading"><div><div class="eyebrow">EXPLAINABLE ARCHITECTURE</div><h1>Follow the evidence.</h1><p>Source to configuration to connection. One environment at a time.</p></div><button class="secondary-button" @click="exportData">↥ Export analysis</button></div>
        <div class="analysis-scope"><div><span class="scope-label">ANALYZING</span><strong>{{data.name}}</strong><span class="scope-divider">/</span><label><span class="sr-only">Analysis environment</span><select aria-label="Analysis environment" v-model="environment"><option v-for="s in data.snapshots" :value="s.environment">{{s.environment}}</option></select></label></div><span>Local Helm render · source/config conclusions</span></div>
        <div class="summary-grid"><div class="summary-card"><span class="summary-icon purple">↗</span><div><strong>{{snapshot.dependencies.length}}</strong><span>Resolved connections</span></div></div><div class="summary-card"><span class="summary-icon blue">◈</span><div><strong>{{snapshot.candidates.length}}</strong><span>Source candidates</span></div></div><div class="summary-card"><span class="summary-icon green">⊘</span><div><strong>{{snapshot.candidates.filter(c=>c.eligibility==='disabled').length}}</strong><span>Explicitly disabled</span></div></div><div class="summary-card"><span class="summary-icon amber">?</span><div><strong>{{snapshot.candidates.filter(c=>c.eligibility==='unknown'||c.targetResolution!=='unique').length}}</strong><span>Need investigation</span></div></div></div>
        <DataContext :analysis="data" :snapshot="snapshot" :environment="environment" @runtime="tab='runtime'"/>
        <details v-if="snapshot.inputLock.revisionVector" class="revision-panel"><summary>Pinned repositories · {{Object.keys(snapshot.inputLock.revisionVector).length}} independent revisions</summary><p>Source/config inputs only. These commits do not prove deployed release versions.</p><div v-for="(revision,repository) in snapshot.inputLock.revisionVector" :key="repository"><strong>{{repository}}</strong><code>{{revision}}</code></div></details><section class="analysis-panel"><AnalysisTabs v-model="tab"/><div id="analysis-view-panel" role="tabpanel" :aria-labelledby="'analysis-tab-'+tab" tabindex="0">
          <RuntimeRefresh v-show="tab==='runtime'" :analysis="data" :environment="environment" @updated="data=$event"/>
          <div v-if="tab==='evidence'||tab==='graph'" class="analysis-split" :class="{'graph-split':tab==='graph'}"><AnalysisGraph v-if="tab==='graph'" :snapshot="snapshot" :traffic="data.traffic?.[environment]" :runtime="data.runtime?.[environment]" @runtime="runtimeSelected=$event;tab='runtime'" :selected="candidate?.id" @select="selected=$event"/><CandidateList v-else :candidates="filteredCandidates" :total="snapshot.candidates.length" :selected="candidate?.id" v-model:query="candidateQuery" v-model:filter="candidateFilter" @select="selected=$event"/>
            <div v-if="candidate" class="evidence-detail"><div class="detail-heading"><div><div class="eyebrow">CONNECTION EXPLANATION</div><h2>{{candidate.name}}</h2></div><span class="analysis-status" :class="candidate.eligibility">{{candidate.eligibility==='enabled'&&candidate.targetResolution==='unique'?'Included':label(candidate.eligibility)}}</span></div>
              <div class="connection-strip"><div><small>SOURCE</small><strong>{{candidate.source}}</strong></div><span>→</span><div><small>{{candidate.targetResolution==='unique'?'RESOLVED TARGET':'TARGET'}}</small><strong>{{candidate.target??candidate.targetResolution}}</strong></div></div>
              <div v-if="sourceInstance" class="binding-detail"><strong>{{candidate.sourceProject}} / {{candidate.sourceService}}</strong><p>Instance {{sourceInstance.id}} · {{sourceInstance.scope.cluster}} / {{sourceInstance.scope.namespace}} / {{sourceInstance.scope.name}}</p><p v-for="r in sourceRevisions">Source {{r.repository}} <code>{{r.revision}}</code></p><p v-if="candidate.targetService">Target {{candidate.targetProject}} / {{candidate.targetService}} · instance {{candidate.target}}</p></div><div class="dimension-grid"><div><span>Target mapping</span><strong>{{candidate.targetResolution}}</strong></div><div><span>Runtime evidence</span><strong>{{candidate.runtimeSupport}}<small v-if="candidate.runtimeSupport==='observed'"> · {{freshness}}</small></strong></div><div><span>Consistency</span><strong>{{candidate.consistency}}</strong></div></div>
              <section v-if="candidate.extraction" class="ai-candidate-note" aria-label="AI candidate review"><h3>AI-assisted candidate · {{candidate.extraction.status}}</h3><p>Evidence bytes and scope verified. Semantic interpretation is {{candidate.extraction.status==='accepted'?'accepted by a declared operator review, not verified by a language parser':'not accepted for a dependency edge'}}.</p><p>Protocol: {{candidate.extraction.protocol}} · Reviewer: {{candidate.extraction.reviewer??'None'}}</p><p v-if="candidate.extraction.reason">{{candidate.extraction.reason}}</p><small>Candidate hash: {{candidate.extraction.candidateHash}}</small></section>
              <section v-if="candidate.extraction" class="ai-candidate-note" aria-label="AI source citations"><h3>Review the cited source</h3><div v-for="e in aiCitations" :key="e.id"><strong>{{e.locator}}:{{e.startLine}}–{{e.endLine}}</strong><small>Commit {{e.provenance?.revision}}</small><pre>{{e.quote}}</pre></div><p>Exact source bytes do not prove the interpretation. Review decisions are saved through the local CLI, then reanalyzed; this page remains read only.</p><a href="https://github.com/Ping-Lin/archi/blob/feat/architecture-poc/docs/ai-candidates.md#review-queue-and-safe-manifest-output" target="_blank" rel="noopener noreferrer">Review workflow and commands ↗</a></section>
              <h3>Why this result</h3><ul class="reason-list"><li v-for="reason in candidate.reasons">{{reason}}</li></ul>
              <section v-if="placeholderFacts.length" class="ai-candidate-note" aria-label="Placeholder resolution"><h3>Resolved configuration references</h3><div v-for="fact in placeholderFacts" :key="fact.id"><strong>{{fact.subject}}</strong><pre>{{fact.value.value}}</pre><p>Referenced keys: {{fact.value.references.join(', ')||'None'}}</p><p v-if="fact.value.defaultsUsed.length">Defaults used for: {{fact.value.defaultsUsed.join(', ')}}</p><small>{{fact.value.inputFactIds.length}} supporting value facts · {{fact.value.rule}}</small></div><p>Resolved after overrides within the reviewed source scope. No host environment or cluster was queried.</p></section>
              <section v-if="candidate.endpointBinding" class="ai-candidate-note" aria-label="Endpoint configuration binding"><h3>Endpoint configuration · {{candidate.endpointBinding.kind}}</h3><p v-for="(value,key) in candidate.value" :key="key"><code>{{key}}</code> → {{value??'Missing value'}}</p><p v-for="fact in facts.filter(f=>f.predicate==='endpoint.binding')" :key="fact.id">Endpoint identity: <code>{{fact.value.url??'Unknown'}}</code></p><p v-if="candidate.endpointAdapter==='grpc-endpoint/1'">gRPC · Transport security: unknown. grpc:// is an internal comparison identity, not a client target URI. DNS answers, TLS/mTLS, authority overrides and load balancing are unverified.</p><p>Only supported configuration composition; no live connection was tested.</p></section>
              <h3>Evidence trail <span>{{chain.length+1}} steps</span></h3><ol class="evidence-timeline"><li><span class="step-marker">1</span><div><strong>Source candidate</strong><p>{{candidate.file}}:{{candidate.line}}</p><code>{{candidate.key??'No supported literal key'}}</code></div></li><li v-for="(fact,i) in chain" :key="fact.id"><span class="step-marker">{{i+2}}</span><div><strong>{{fact.predicate==='property.value'?'Configuration value':fact.predicate==='resource.present'?'Rendered target resource':'Runtime observation'}}</strong><p v-for="e in evidenceFor(fact)">{{e.locator}}</p><code>{{fact.value.value??fact.value.name??fact.value.target}}</code><small v-if="fact.predicate==='property.value'">Precedence {{fact.value.precedence}} · later supported source wins</small></div></li></ol>
              <details class="fact-details"><summary>Inspect all input facts ({{facts.length}})</summary><div v-for="fact in facts" :key="fact.id"><strong>{{fact.predicate}}</strong><pre>{{JSON.stringify(fact.value,null,2)}}</pre><p v-for="e in evidenceFor(fact)">{{e.type}} · {{e.locator}}<br><small>SHA-256 {{e.contentHash}}</small></p></div></details>
              <div class="resolution-footer"><span>{{resolution.rule}} · {{resolution.version}}</span><code>{{resolution.id}}</code></div>
            </div><div v-else class="analysis-empty">{{snapshot.candidates.length?'No candidate matches these filters. Clear filters to inspect other connections.':'No supported client candidates were extracted. Inspect diagnostics below.'}}</div>
          </div>
          <RuntimePanel v-else-if="tab==='runtime'" :overlay="data.runtime?.[environment]" :selected="runtimeSelected"/><TrafficPanel v-else-if="tab==='traffic'" :report="data.traffic?.[environment]"/><div v-else-if="tab==='resources'" class="analysis-table-wrap"><div class="inventory-intro"><h2>Presence is not health.</h2><p>Within the selected render scopes. Comparison covers container images only; scaling ownership and release correspondence are unknown.</p></div><table class="analysis-table"><thead><tr><th>Resource</th><th>Presence</th><th>Supported fields</th><th>Observed health</th></tr></thead><tbody><tr v-for="r in snapshot.resourceComparisons" :key="JSON.stringify([r.caller,r.key])"><td><strong>{{r.name}}</strong><small>{{r.caller ? r.caller+' · ' : ''}}{{r.kind}} · {{r.uid??'No observed UID'}}</small></td><td>{{label(r.presence)}}</td><td>{{label(r.comparison)}}</td><td><span class="analysis-status" :class="r.health==='ready'?'enabled':'unknown'">{{r.health}}</span><small v-if="r.replicas">{{r.replicas.ready??'?'}} / {{r.replicas.live??'?'}} ready</small></td></tr></tbody></table></div>
          <div v-else class="analysis-table-wrap"><div class="inventory-intro"><h2>Independent inputs. Different outcomes.</h2><p>Dev observations never confirm production dependencies. Disabled candidates keep their explanation.</p></div><table class="analysis-table"><thead><tr><th>Candidate</th><th v-for="s in data.snapshots">{{s.environment}}</th></tr></thead><tbody><tr v-for="row in compareRows"><td><strong>{{row.source}} / {{row.name}}</strong></td><td v-for="s in data.snapshots"><template v-for="c in s.candidates.filter(c=>c.source===row.source&&c.name===row.name)"><span class="analysis-status" :class="c.eligibility">{{c.eligibility}}</span><small>{{c.target??c.targetResolution}} · runtime {{c.runtimeSupport}}</small></template><small v-if="!s.candidates.some(c=>c.source===row.source&&c.name===row.name)">Not discovered within analyzed scope</small></td></tr></tbody></table><div class="snapshot-hashes"><div v-for="s in data.snapshots"><strong>{{s.environment}}</strong><code>{{s.contentHash}}</code></div></div></div>
          <footer class="analysis-panel-footer"><span>◇ {{snapshot.evidence.length}} evidence records · {{snapshot.facts.length}} facts</span><span>Assessment {{data.run.assessedAt}}</span></footer>
          </div>
        </section>
        <details class="analysis-diagnostics"><summary>Analysis coverage & diagnostics <span>{{snapshot.diagnostics.length}} items</span></summary><div class="coverage-grid"><div v-for="c in snapshot.coverage"><strong>{{c.caller ? c.caller+' · ' : ''}}{{c.collector}} · {{c.status}}</strong><p>{{c.meaning}}</p></div></div><p v-for="d in snapshot.diagnostics"><code>{{d.code}}</code> {{d.caller ? d.caller+': ' : ''}}{{d.message}}</p><p>Input mode: {{data.run.inputMode}}. SHA-256 locks identify captured bytes. Source commit does not prove the deployed revision.</p></details>
        <div class="page-footer"><span>Explain the connection. Preserve the uncertainty.</span><span>Bounded Spring analysis · imported observations</span></div>
      </main><main v-else><p>Loading evidence…</p></main>
    </div>
  </div>`,
};
