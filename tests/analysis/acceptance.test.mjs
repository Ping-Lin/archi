import test from "node:test";
import assert from "node:assert/strict";
import { scenarioBundle, captureBundle, verifyBundle } from "../../src/runtime/acceptance.mjs";
import { seal } from "../../src/runtime/contract.mjs";
import { compareRuntime } from "../../web/runtime-comparison.mjs";
import { verifyDisplayBundle, expectationRows } from "../../web/acceptance-view.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("scenario bundle replays all 14 cases against independent expectations", async () => {
  const bundle = await scenarioBundle();
  assert.equal(bundle.cases.length, 14);
  assert.deepEqual(await scenarioBundle(), bundle);
  const results = await verifyBundle(bundle);
  assert.ok(results.every((r) => r.replay === "matched" && r.expectation === "matched"));
  assert.deepEqual(await verifyDisplayBundle(bundle), bundle);
  for (const c of bundle.cases) assert.ok(expectationRows(c).every((r) => r.result === "matched"));
});
test("tampering, substituted oracle and mismatched engine cannot certify acceptance", async () => {
  const bundle = await scenarioBundle();
  bundle.cases[0].title = "tampered";
  await assert.rejects(verifyBundle(bundle), /hash mismatch/);
  await assert.rejects(verifyDisplayBundle(bundle), /integrity/);
  await assert.rejects(verifyBundle(seal(bundle)), /inputs or oracle differ/);
  bundle.engine.ruleVersion = "unknown/99";
  await assert.rejects(verifyBundle(seal(bundle)), /engine differs/);
});
test("captured inputs replay without inventing an independent oracle or altering source analysis", async () => {
  const scenario = await scenarioBundle(), first = scenario.cases[0];
  const analysis = { schemaVersion: first.snapshot.schemaVersion, simulation: true, snapshots: [first.snapshot] };
  const original = structuredClone(analysis);
  const b = await captureBundle(analysis, [first.capture], first.options);
  assert.deepEqual(analysis, original);
  assert.equal((await verifyBundle(b))[0].expectation, "not-provided");
  b.cases[0].report.findings[0].classification = "reported-failure";
  b.cases[0].report = seal(b.cases[0].report);
  await assert.rejects(verifyBundle(seal(b)), /replay differs/);
  await assert.rejects(captureBundle({ ...analysis, simulation: false }, [first.capture], first.options), /mix synthetic/);
});
test("comparison distinguishes rollback and recreation from failure or deletion", async () => {
  const b = await scenarioBundle();
  const report = (id) => structuredClone(b.cases.find((c) => c.id === id).report);
  const rows = compareRuntime(report("T4/qa"), report("T5/qa"));
  const orders = rows.find((r) => r.key.includes("orders-qa"));
  assert.ok(orders.changes.includes("workloadImages"));
  assert.equal(orders.after.classification, "information");
  assert.equal(orders.identity, "same-uid");
  const recreated = report("T5/qa"); recreated.findings[0].uid = "new-uid";
  assert.equal(compareRuntime(report("T4/qa"), recreated).find((r) => r.key.includes("portal-qa")).identity, "recreated");
  recreated.findings = [];
  assert.ok(compareRuntime(report("T4/qa"), recreated).every((r) => r.coverage === "not-in-after-report"));
  assert.throws(() => compareRuntime(report("T0/qa"), report("T0/production")), /same environment/);
  assert.deepEqual(compareRuntime(report("T0/qa"), report("T0/qa")).flatMap((r) => r.changes), []);
});

test("acceptance CLI creates a replayable bundle without overwriting existing evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "archi-acceptance-"));
  const out = path.join(dir, "bundle.json");
  const cli = (...args) => execFileSync(process.execPath, ["scripts/runtime-acceptance.mjs", ...args], { encoding: "utf8", stdio: "pipe" });
  try {
    assert.match(cli("--scenarios", "--out", out), /T6\/production: replay matched/);
    const original = await readFile(out, "utf8");
    assert.match(cli("--verify", out), /independent expectation matched/);
    assert.throws(() => cli("--scenarios", "--out", out));
    assert.equal(await readFile(out, "utf8"), original);
    assert.throws(() => cli("--verify", out, "--scenarios"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
