import { VERSION } from "../../src/analysis/contract.mjs";
import { CAPTURE_VERSION, seal } from "../../src/runtime/contract.mjs";
import { specimen } from "./fixture.mjs";

// Authored normalized specimens, not captured CD executions or pinned Git releases.
const phases = [
  { id: "T0", baseline: "v1", portal: "v1", orders: "v1" },
  { id: "T1", baseline: "v2", portal: "v1", orders: "v1" },
  { id: "T2", baseline: "v2", portal: "v2", orders: "v1" },
  { id: "T3", baseline: "v2", portal: "v2", orders: "v2", rolling: true },
  { id: "T4", baseline: "v2", portal: "v2", orders: "v2", rolling: true, failure: true },
  { id: "T5", baseline: "v2", portal: "v2", orders: "v1" },
  { id: "T6", baseline: "v2", portal: "v2", orders: "v2" },
];
export function runtimeTimeline() {
  return phases.map((phase, index) => {
    const at = `2026-09-25T12:0${index}:00.000Z`;
    const environments = ["qa", "production"].map((environment) => {
      const instances = ["portal", "orders"].map((id) => ({
        id, workload: "api", scope: { cluster: "commerce", namespace: `${id}-${environment}` },
      }));
      const image = (id, version) => `example.invalid/${id}:${version}`;
      const snapshot = seal({
        schemaVersion: VERSION, environment, instances,
        dependencies: [], candidates: [], facts: [], resolutions: [],
        evidence: [{ id: "authored-scenario", environment }],
        resources: instances.map((i) => ({
          key: `commerce|apps|deployments|${i.scope.namespace}|api`, kind: "Deployment",
          evidenceId: "authored-scenario",
          spec: { template: { spec: { containers: [{ name: "app",
            image: image(i.id, environment === "production" ? "v1" : phase.baseline) }] } } },
        })),
      });
      const collections = [];
      for (const i of instances) {
        const ns = i.scope.namespace;
        const rolling = environment === "qa" && i.id === "orders" && phase.rolling;
        const version = environment === "production" ? "v1" : phase[i.id];
        const d = specimen("Deployment", ns, "api", `${ns}-deployment`, image(i.id, version), {
          updatedReplicas: rolling ? 1 : 2, currentReplicas: rolling ? 3 : 2,
          conditions: [{ type: "Progressing",
            status: rolling && phase.failure ? "False" : "True",
            reason: rolling && phase.failure ? "ProgressDeadlineExceeded" : "NewReplicaSetAvailable" }],
        });
        const sets = [], pods = [];
        for (const [label, tag, count, ready] of rolling
          ? [["old", "v1", 2, true], ["new", version, 1, false]]
          : [["current", version, 2, true]]) {
          const rs = specimen("ReplicaSet", ns, `api-${label}`, `${ns}-rs-${label}`, image(i.id, tag), {
            replicas: count, currentReplicas: count, readyReplicas: ready ? count : 0,
            availableReplicas: ready ? count : 0,
            owners: [{ kind: "Deployment", uid: d.uid, controller: true }],
          });
          sets.push(rs);
          for (let n = 0; n < count; n++) pods.push(specimen("Pod", ns,
            `api-${label}-${n}`, `${ns}-pod-${label}-${n}`, image(i.id, tag), {
              owners: [{ kind: "ReplicaSet", uid: rs.uid, controller: true }],
              conditions: [{ type: "Ready", status: ready ? "True" : "False", reason: null }],
            }));
        }
        for (const [kind, resources] of [["Deployment", [d]], ["ReplicaSet", sets], ["Pod", pods]])
          collections.push({ namespace: ns, kind, selector: null, status: "complete", reason: null,
            startedAt: at, finishedAt: at, resourceVersion: "100", resources });
      }
      return { snapshot, capture: seal({ schemaVersion: CAPTURE_VERSION,
        adapter: "kubernetes-inventory/1", simulation: true, environment, cluster: "commerce",
        context: "synthetic-commerce", clusterIdentity: "operator-asserted",
        startedAt: at, finishedAt: at, collections }) };
    });
    return { id: phase.id, at, environments };
  });
}
