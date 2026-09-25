import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runtimeTimeline } from "../../examples/runtime/timeline.mjs";
import { reconcileRuntime } from "../../src/runtime/reconcile.mjs";
import { seal } from "../../src/runtime/contract.mjs";

const oracle = JSON.parse(await readFile(new URL("../fixtures/runtime-timeline-oracle.json", import.meta.url)));
const summarize = (f) => [f.specAlignment, f.rollout, f.classification];
for (const phase of runtimeTimeline()) test(`${phase.id}: independent CD scenario matches authored oracle`, () => {
  for (const { snapshot, capture } of phase.environments) {
    const before = structuredClone({ snapshot, capture });
    const report = reconcileRuntime(snapshot, capture, { assessedAt: phase.at });
    assert.deepEqual({ snapshot, capture }, before);
    for (const f of report.findings) {
      assert.deepEqual(summarize(f), snapshot.environment === "qa"
        ? oracle[phase.id][f.instanceId] : ["matching", "complete", "information"]);
      assert.equal(f.consistency.status, "no-discrepancy-detected");
      assert.equal(f.availability, "available");
      assert.equal(f.reportedFailures.length, f.classification === "reported-failure" ? 1 : 0);
      const mixed = snapshot.environment === "qa" && f.instanceId === "orders" &&
        ["T3", "T4"].includes(phase.id);
      assert.equal(f.reasonCodes.includes("mixed-pod-image-references"), mixed);
      if (mixed) assert.deepEqual([...new Set(f.pods.flatMap((p) => p.containers.map((c) => c.image)))].sort(),
        ["example.invalid/orders:v1", "example.invalid/orders:v2"]);
      for (const failure of f.reportedFailures) {
        assert.equal(failure.reason, "ProgressDeadlineExceeded");
        assert.ok(report.evidence.some((e) => e.id === failure.evidenceId && e.kind === "Deployment" && e.uid));
      }
      for (const check of f.consistency.checks)
        for (const id of check.evidenceIds) assert.ok(report.evidence.some((e) => e.id === id));
    }
    assert.equal(report.releaseCorrespondence, "unverified");
  }
});

test("inconsistent counts request verification; incomplete lists and old generations remain unknown", () => {
  const { snapshot, capture } = runtimeTimeline()[0].environments[0];
  const pods = capture.collections.find((c) => c.kind === "Pod");
  pods.resources.pop();
  const run = () => reconcileRuntime(snapshot, seal(capture), { assessedAt: capture.finishedAt }).findings[0];
  assert.equal(run().classification, "needs-verification");
  assert.deepEqual(run().reportedFailures, []);
  pods.status = "partial"; pods.reason = "query-failed";
  assert.equal(run().consistency.status, "unknown");
  assert.equal(run().classification, "information");
  pods.status = "complete"; pods.reason = null;
  capture.collections[0].resources[0].observedGeneration = 1;
  assert.equal(run().consistency.status, "unknown");
});

test("only explicit current controller failures qualify; stale evidence stays historical", () => {
  const { snapshot, capture } = runtimeTimeline()[0].environments[0];
  const d = capture.collections[0].resources[0];
  const run = (assessedAt = capture.finishedAt) => reconcileRuntime(snapshot, seal(capture), { assessedAt }).findings[0];
  d.conditions = [{ type: "Progressing", status: "False", reason: "DeploymentPaused" }];
  assert.equal(run().classification, "information");
  d.conditions[0].reason = "ProgressDeadlineExceeded";
  assert.equal(run().classification, "reported-failure");
  assert.equal(run().reportedFailures[0].reason, "ProgressDeadlineExceeded");
  assert.equal(run("2026-09-25T13:00:00Z").freshness, "stale");
  d.observedGeneration = 1;
  assert.equal(run().classification, "information");
  d.observedGeneration = 2;
  d.conditions = [{ type: "ReplicaFailure", status: "True", reason: "FailedCreate" }];
  assert.equal(run().reportedFailures[0].reason, "FailedCreate");
  d.terminating = true;
  assert.equal(run().classification, "information");
});
