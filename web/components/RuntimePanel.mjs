import { displayFreshness, runtimeRows } from "../runtime-view.mjs";
const { computed, ref, watch, onMounted, onUnmounted } = Vue;
const reasons = {
  "image-references-match-only":
    "Container image references match; binary identity is unverified.",
  "baseline-spec-image-difference":
    "The selected repository baseline and workload specify different images.",
  "baseline-comparison-unavailable":
    "There is no comparable rendered image baseline.",
  "deployment-terminating": "The Deployment is being deleted.",
  "controller-generation-unobserved":
    "The controller has not confirmed the current workload generation.",
  "zero-desired-replicas": "The workload requests zero replicas.",
  "controller-availability-counts":
    "Availability reflects the controller's reported replica counts.",
  "rollout-paused": "The rollout is paused.",
  "rollout-progress-failed":
    "The controller reports Progressing=False; inspect the condition reason before interpreting it as failure.",
  "controller-rollout-complete":
    "Updated, total and available replica counts match the requested count.",
  "controller-rollout-progressing":
    "The controller reports an ongoing rollout.",
  "mixed-pod-image-references":
    "Observed Pods contain multiple image versions.",
  "pod-spec-image-difference":
    "Some Pod image references differ from the current workload spec.",
  "no-owned-pods-in-capture":
    "No Pods could be linked through controller ownership in this capture.",
  "pod-image-ids-not-equivalence-proof":
    "Reported image IDs are retained without claiming binary equivalence.",
  "collection-is-not-atomic":
    "Resources were collected at different moments; transient differences are possible.",
  "namespace-not-collected": "This namespace was not collected.",
  "absent-in-complete-namespace-list":
    "The workload was absent from a complete namespace inventory.",
  "incomplete-list-cannot-establish-absence":
    "Collection was incomplete; workload absence cannot be established.",
  "unbound-runtime-workload":
    "This observed workload has no matching architecture instance binding.",
};
export default {
  props: ["overlay", "selected"],
  setup(props) {
    const selection = ref(null), expanded = ref(false),
      now = ref(Date.now());
    let timer;
    onMounted(() => {
      timer = setInterval(() => {
        now.value = Date.now();
      }, 30000);
    });
    onUnmounted(() => clearInterval(timer));
    const rows = computed(() => runtimeRows(props.overlay));
    const key = (row) =>
      JSON.stringify([row.finding.cluster, row.finding.resourceKey]);
    watch(
      () => [props.overlay, props.selected],
      (values, oldValues) => {
        const retained = selection.value && values[1] === oldValues?.[1]
          ? rows.value.find((r) => key(r) === key(selection.value) && r.report.environment === selection.value.report.environment)
          : null;
        selection.value =
          retained ?? rows.value.find((r) => r.finding.instanceId === props.selected) ??
          null;
      },
      { immediate: true },
    );
    const freshness = (row) =>
      displayFreshness(row.report, row.finding, now.value);
    const evidence = computed(
      () =>
        selection.value?.report.evidence.filter((e) =>
          selection.value.finding.evidenceIds.includes(e.id),
        ) ?? [],
    );
    return {
      rows,
      selection,
      expanded,
      key,
      freshness,
      evidence,
      reasonText: (code) => reasons[code] ?? code,
    };
  },
  template: `<section class="runtime-panel">
    <div class="inventory-intro"><div class="eyebrow">DEPLOYMENT EVIDENCE</div><h2>Configuration and execution, side by side.</h2><p>Captured observations only. Matching references do not prove identical binaries or deployed source revisions.</p></div>
    <div v-if="!overlay" class="analysis-empty"><h3>No runtime capture</h3><p>Import a scoped inventory capture. Static architecture remains available.</p></div>
    <template v-else>
      <div class="runtime-captures"><div v-for="r in overlay.reports" :key="r.cluster"><strong>{{r.cluster}} · {{r.environment}}</strong><span>{{r.simulation?'Synthetic specimen':'Imported cluster capture'}} · {{r.startedAt}} → {{r.finishedAt}}</span><small>Identity: {{r.clusterIdentity}} · Assessment: {{r.assessedAt}} · TTL {{r.ttlSeconds}}s</small></div></div>
      <div class="runtime-table-controls"><label><input type="checkbox" v-model="expanded"> Show comparison columns</label><p>Select a workload for image and consistency details. Version differences alone are informational.</p></div>
      <div class="analysis-table-wrap" tabindex="0" role="region" aria-label="Runtime inventory table, scroll horizontally if needed"><table class="analysis-table runtime-table"><thead><tr><th scope="col">Deployment</th><th v-if="expanded" scope="col">Presence</th><th v-if="expanded" scope="col">Image references</th><th scope="col">Rollout at capture</th><th scope="col">Availability at capture</th><th v-if="expanded" scope="col">Assessment at capture</th><th scope="col">Evidence quality</th></tr></thead><tbody>
      <tr v-for="row in rows" :key="key(row)"><td><button class="runtime-select" :aria-pressed="selection?key(selection)===key(row):false" @click="selection=row">{{row.finding.instanceId??row.finding.workload}}</button><small>{{row.finding.cluster}} / {{row.finding.namespace}}</small><small v-if="!expanded">Presence: {{row.finding.presence}}</small><small v-if="row.finding.classification==='reported-failure'">Controller-reported failure · inspect details</small><small v-else-if="row.finding.classification==='needs-verification'">Needs verification · inspect details</small><small v-if="!row.finding.instanceId">Unbound runtime workload</small></td><td v-if="expanded">{{row.finding.presence}}</td><td v-if="expanded">{{row.finding.specAlignment}}</td><td>{{row.finding.rollout}}</td><td>{{row.finding.availability}}<small v-if="row.finding.replicas">{{row.finding.replicas.available??'?'}} / {{row.finding.replicas.desired??'?'}} available</small></td><td v-if="expanded">{{row.finding.classification??'not assessed'}}<small>Consistency: {{row.finding.consistency?.status??'not assessed'}}</small></td><td>{{freshness(row)}}<small>Collection: {{row.finding.acquisition}} · Pod coverage: {{row.finding.podCoverage}}</small></td></tr>
      </tbody></table></div>
      <section v-if="selection" class="runtime-detail" aria-label="Runtime workload details"><div class="eyebrow">THREE INDEPENDENT STATES</div><h3>{{selection.finding.instanceId??selection.finding.workload}}</h3><p>{{selection.finding.namespace}} / {{selection.finding.workload}} · UID {{selection.finding.uid??'unknown'}}</p>
        <p>Assessment at capture: <strong>{{selection.finding.classification??'not assessed by this rule version'}}</strong> · Evidence: {{freshness(selection)}}. Version differences alone are informational.</p>
        <p>Presence: {{selection.finding.presence}} · Image references: {{selection.finding.specAlignment}} · Collection: {{selection.finding.acquisition}}</p>
        <p>Consistency: {{selection.finding.consistency?.status??'not assessed'}}. Separate resource lists may capture different moments; no discrepancy detected does not certify data correctness.</p>
        <ul v-if="selection.finding.reportedFailures?.length"><li v-for="failure in selection.finding.reportedFailures">Controller-reported failure at capture: {{failure.type}}={{failure.status}} · {{failure.reason??'reason not supplied'}} · Evidence {{failure.evidenceId}}</li></ul>
        <details v-if="selection.finding.consistency?.checks.length"><summary>Consistency checks</summary><pre>{{JSON.stringify(selection.finding.consistency.checks,null,2)}}</pre></details>
        <div class="runtime-three"><div><h4>Selected repository render</h4><p v-for="c in selection.finding.baselineImages"><strong>{{c.name}}</strong><code>{{c.image}}</code></p><p v-if="!selection.finding.baselineImages.length">No comparable baseline</p></div><div><h4>Live workload spec at capture</h4><p v-for="c in selection.finding.workloadImages"><strong>{{c.name}}</strong><code>{{c.image}}</code></p><p v-if="!selection.finding.workloadImages.length">No workload observation</p></div><div><h4>Observed Pods</h4><p>{{selection.finding.pods.length}} owned Pods · {{selection.finding.podCoverage}} coverage</p><article v-for="p in selection.finding.pods"><strong>{{p.name}}</strong><small>Ready: {{p.ready}} · {{p.terminating?'terminating':'not terminating'}}</small><code v-for="c in p.containers">{{c.name}}: {{c.image}}</code><details><summary>Reported container identities</summary><pre>{{JSON.stringify(p.containerStatuses,null,2)}}</pre></details></article></div></div>
        <h4>Reasons</h4><ul><li v-for="reason in selection.finding.reasonCodes">{{reasonText(reason)}}</li></ul>
        <details><summary>Evidence and provenance</summary><p>Static snapshot: {{selection.report.staticContentHash}}</p><p>Capture: {{selection.report.captureHash}}</p><p>Rule: {{selection.report.ruleVersion}} · Image identity: {{selection.finding.imageIdentity}}</p><p>Baseline evidence: {{selection.finding.baselineEvidenceIds.join(', ')}}</p><pre>{{JSON.stringify(evidence,null,2)}}</pre></details>
      </section>
    </template>
  </section>`,
};
