import { readFile } from "node:fs/promises";
import { hash } from "../analysis/contract.mjs";
import { boundedJson, insist, validateAnalysis, verifyHash } from "../traffic/validation.mjs";
import { reconcileRuntime } from "./reconcile.mjs";
import { RULE_VERSION, seal } from "./contract.mjs";
import { runtimeTimeline } from "../../examples/runtime/timeline.mjs";

export const ACCEPTANCE_VERSION = "archi/runtime-acceptance-v1alpha1";
const descriptions = [
  "Both services run v1", "Baseline advances before deployment", "Portal deploys independently",
  "Orders rolls out with mixed Pod versions", "Controller reports a rollout deadline failure",
  "Orders rolls back while the baseline remains v2", "QA reaches v2; production stays v1",
];
export async function runtimeEngine() {
  const files = ["./reconcile.mjs", "./contract.mjs", "../analysis/contract.mjs",
    "../analysis/bindings.mjs", "../traffic/validation.mjs", "../../package-lock.json"];
  return { ruleVersion: RULE_VERSION, sourceHash: hash(await Promise.all(files.map(async (file) =>
    [file, await readFile(new URL(file, import.meta.url), "utf8")]))), minimumNodeMajor: 22 };
}
function makeCase(id, title, snapshot, capture, options, expected = null) {
  return { id, title, snapshot, capture, options, expected,
    report: reconcileRuntime(snapshot, capture, options) };
}
export async function scenarioBundle() {
  const oracle = JSON.parse(await readFile(new URL("../../tests/fixtures/runtime-timeline-oracle.json", import.meta.url)));
  return seal({ schemaVersion: ACCEPTANCE_VERSION, mode: "scenarios", simulation: true,
    engine: await runtimeEngine(), sourceAnalysis: null,
    cases: runtimeTimeline().flatMap((phase, n) => phase.environments.map(({ snapshot, capture }) =>
      makeCase(`${phase.id}/${snapshot.environment}`, descriptions[n], snapshot, capture,
        { assessedAt: phase.at, ttlSeconds: 300 }, snapshot.environment === "qa" ? oracle[phase.id] : {
          portal: ["matching", "complete", "information"], orders: ["matching", "complete", "information"],
        }))),
  });
}
export async function captureBundle(analysis, captures, options) {
  validateAnalysis(analysis);
  insist(captures.length > 0 && captures.length <= 100, "1–100 captures required");
  const cases = captures.map((capture, n) => {
    insist(capture.simulation === analysis.simulation, "Do not mix synthetic and real captures");
    const snapshot = analysis.snapshots.find((s) => s.environment === capture.environment);
    insist(snapshot, "capture environment is absent from analysis");
    return makeCase(`capture-${n + 1}`, `${capture.environment} / ${capture.cluster} / ${capture.finishedAt}`,
      snapshot, capture, options);
  });
  return seal({ schemaVersion: ACCEPTANCE_VERSION, mode: "captures", simulation: analysis.simulation,
    engine: await runtimeEngine(), sourceAnalysis: analysis, cases });
}
function keys(value, names, label) {
  insist(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...names].sort().join("|"), `invalid ${label} fields`);
}
export async function verifyBundle(bundle) {
  boundedJson(bundle);
  keys(bundle, ["schemaVersion", "mode", "simulation", "engine", "sourceAnalysis", "cases", "contentHash"], "bundle");
  verifyHash(bundle, "acceptance bundle");
  insist(bundle.schemaVersion === ACCEPTANCE_VERSION && ["scenarios", "captures"].includes(bundle.mode) &&
    typeof bundle.simulation === "boolean", "unsupported acceptance bundle");
  insist(hash(bundle.engine) === hash(await runtimeEngine()), "runtime engine differs; use the original code and lockfile");
  insist(Array.isArray(bundle.cases) && bundle.cases.length > 0 && bundle.cases.length <= 100, "invalid case count");
  if (bundle.mode === "scenarios") {
    insist(bundle.simulation && bundle.sourceAnalysis === null, "scenario bundle must be synthetic");
    // An altered oracle must not manufacture a passing built-in scenario.
    insist(bundle.contentHash === (await scenarioBundle()).contentHash, "built-in scenario inputs or oracle differ");
  } else {
    validateAnalysis(bundle.sourceAnalysis);
    insist(bundle.simulation === bundle.sourceAnalysis.simulation, "analysis input mode mismatch");
  }
  const ids = new Set();
  return bundle.cases.map((c) => {
    keys(c, ["id", "title", "snapshot", "capture", "options", "expected", "report"], "case");
    insist(typeof c.id === "string" && c.id.length > 0 && c.id.length <= 128 && !ids.has(c.id), "invalid case identity");
    ids.add(c.id);
    insist(typeof c.title === "string" && c.title.length <= 1024, "invalid case title");
    keys(c.options, ["assessedAt", "ttlSeconds"], "assessment options");
    insist(c.capture.simulation === bundle.simulation, "capture input mode mismatch");
    if (bundle.mode === "captures") {
      insist(c.expected === null, "captured inputs have no independent acceptance oracle");
      insist(bundle.sourceAnalysis.snapshots.some((s) => hash(s) === hash(c.snapshot)), "case baseline differs from source analysis");
    }
    const replay = reconcileRuntime(c.snapshot, c.capture, c.options);
    insist(hash(replay) === hash(c.report), `replay differs for ${c.id}`);
    const actual = Object.fromEntries(replay.findings.filter((f) => f.instanceId !== null)
      .map((f) => [f.instanceId, [f.specAlignment, f.rollout, f.classification]]));
    return { id: c.id, replay: "matched", expectation: c.expected === null ? "not-provided"
      : hash(actual) === hash(c.expected) ? "matched" : "mismatch" };
  });
}
