import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  analyze,
  checkOracle,
  composeCallers,
} from "../../src/analysis/run.mjs";
import {
  validateConfig,
  assertSnapshot,
} from "../../src/analysis/contract.mjs";
import { projectServiceGraph } from "../../web/analysis-graph.mjs";
const root = fileURLToPath(new URL("../..", import.meta.url));
const config = JSON.parse(
  await readFile(root + "/examples/system/archi.config.json", "utf8"),
);
test("multi-caller scopes must cover unique sources exactly", () => {
  validateConfig(config);
  for (const mutate of [
    (c) => c.sources.push(c.sources[0]),
    (c) => c.environments[0].callers.pop(),
    (c) => c.environments[0].callers.push(c.environments[0].callers[0]),
    (c) => (c.environments[0].callers[0].service = "foreign"),
    (c) => (c.source = c.sources[0]),
    (c) => (c.environments[0].targets[0].kind = "external"),
    (c) =>
      (c.environments[0].callers[0].observations =
        c.environments[0].callers[1].observations),
  ]) {
    const c = structuredClone(config);
    mutate(c);
    assert.throws(() => validateConfig(c));
  }
});
test("composition rejects mixing environments and input revisions", () => {
  assert.throws(
    () =>
      composeCallers(
        [
          { environment: "qa", inputLock: {} },
          { environment: "prod", inputLock: {} },
        ],
        [],
      ),
    /Cannot compose/,
  );
  assert.throws(
    () =>
      composeCallers(
        [
          { environment: "qa", inputLock: { revision: "a" } },
          { environment: "qa", inputLock: { revision: "b" } },
        ],
        [],
      ),
    /Cannot compose/,
  );
});
let available = true;
try {
  execFileSync(process.env.HELM_BIN ?? "helm", ["version", "--short"], {
    stdio: "ignore",
  });
} catch {
  available = false;
}
if (process.env.CI && !available)
  throw Error("Helm required for multi-caller gate");
test(
  "multi-caller pipeline preserves same-file identities, observation scope and deterministic chains",
  { skip: !available },
  async () => {
    const a = await analyze(root, "examples/system/archi.config.json", {
      asOf: "2026-09-17T00:30:00Z",
    });
    await checkOracle(a, root + "/tests/fixtures/system-oracle.json");
    const b = await analyze(root, "examples/system/archi.config.json", {
      asOf: "2026-09-18T00:00:00Z",
    });
    assert.deepEqual(
      a.snapshots.map((s) => s.contentHash),
      b.snapshots.map((s) => s.contentHash),
    );
    const [qa, prod] = a.snapshots;
    const downstream = qa.candidates.filter((c) => c.name === "downstream");
    assert.equal(new Set(downstream.map((c) => c.id)).size, 3);
    assert.deepEqual(
      downstream.map((c) => c.runtimeSupport),
      ["unavailable", "observed", "unavailable"],
    );
    assert.ok(prod.candidates.every((c) => c.runtimeSupport === "unavailable"));
    assert.equal(qa.observation.coverage, "partial");
    assert.equal(qa.observation.collectedAt, null);
    for (const c of qa.candidates) {
      const r = qa.resolutions.find((r) => r.id === c.resolutionId);
      assert.equal(r.caller, c.source);
      assert.ok(
        r.inputFactIds
          .map((id) => qa.facts.find((f) => f.id === id))
          .every((f) => !f.caller || f.caller === c.source),
      );
    }
    const broken = structuredClone(qa);
    broken.candidates[0].resolutionId = downstream[1].resolutionId;
    assert.throws(() => assertSnapshot(broken), /Cross-caller/);
    const g = projectServiceGraph(prod),
      node = (id) => g.nodes.find((n) => n.id === id);
    assert.equal(g.nodes.length, 4);
    assert.equal(g.edges.length, 3);
    assert.ok(
      node("storefront").y < node("orders").y &&
        node("orders").y < node("inventory").y &&
        node("inventory").y < node("warehouse").y,
    );
    assert.equal(qa.resources.length, 6);
    assert.ok(
      Object.keys(qa.inputLock.files).includes(
        "examples/system/environments/orders-observations.json",
      ),
    );
    assert.ok(
      !Object.keys(prod.inputLock.files).includes(
        "examples/system/environments/orders-observations.json",
      ),
    );
  },
);
