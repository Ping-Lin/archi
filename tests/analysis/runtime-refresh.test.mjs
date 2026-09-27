import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "node:http";
import { runtimeTimeline } from "../../examples/runtime/timeline.mjs";
import { createRuntimeRefresh, validateRefreshConfig } from "../../src/runtime/refresh.mjs";
import { collectRuntime } from "../../src/runtime/collect.mjs";
import { seal } from "../../src/runtime/contract.mjs";
import { createExplorer, listen } from "../../src/core/server.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "archi-refresh-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "artifacts/analysis"), { recursive: true });
  const { snapshot, capture } = runtimeTimeline()[0].environments[0];
  const file = path.join(root, "artifacts/analysis/analysis.json");
  const analysis = { schemaVersion: snapshot.schemaVersion, simulation: false, snapshots: [snapshot], sentinel: "preserved" };
  await writeFile(file, JSON.stringify(analysis));
  const config = { schemaVersion: "archi/runtime-refresh-v1alpha1", targets: [{
    id: "qa", environment: "qa", cluster: "commerce", context: capture.context,
    kubeconfig: "/private/not-for-browser", namespaces: ["portal-qa", "orders-qa"],
  }] };
  return { root, file, analysis, config, capture: seal({ ...capture, simulation: false }),
    input: { targetId: "qa", staticContentHash: snapshot.contentHash },
    clock: () => Date.parse(capture.finishedAt) };
}
test("refresh configuration rejects duplicate scopes, extra command fields and relative credentials", () => {
  const config = { schemaVersion: "archi/runtime-refresh-v1alpha1", targets: [] };
  assert.deepEqual(validateRefreshConfig(config), config);
  assert.throws(() => validateRefreshConfig({ ...config, command: "arbitrary" }));
  const target = { id: "qa", environment: "qa", cluster: "cluster", context: "approved", kubeconfig: "relative", namespaces: ["qa"] };
  assert.throws(() => validateRefreshConfig({ ...config, targets: [target] }));
  target.kubeconfig = "/approved/config";
  assert.throws(() => validateRefreshConfig({ ...config, targets: [target, { ...target, id: "other" }] }));
});
test("explicit refresh archives capture and updates shared analysis without acquiring on description", async (t) => {
  const f = await fixture(t); let calls = 0;
  const controller = createRuntimeRefresh(f.root, f.config, { collect: async () => { calls++; return f.capture; }, reader: () => null, clock: f.clock });
  const publicConfig = await controller.describe();
  assert.equal(calls, 0);
  assert.equal(publicConfig.targets[0].enabled, true);
  assert.ok(!JSON.stringify(publicConfig).includes("not-for-browser"));
  const result = await controller.refresh(f.input);
  assert.equal(calls, 1);
  assert.equal(result.analysis.sentinel, "preserved");
  assert.deepEqual(result.analysis.snapshots, f.analysis.snapshots);
  assert.deepEqual(JSON.parse(await readFile(f.file, "utf8")), result.analysis);
  assert.equal((await readdir(path.join(f.root, "artifacts/runtime-captures"))).length, 1);
});
test("partial collection, synthetic input and wrong scope retain previous analysis", async (t) => {
  const f = await fixture(t), before = await readFile(f.file, "utf8");
  const partial = structuredClone(f.capture);
  partial.collections[0].status = "partial"; partial.collections[0].reason = "query-failed";
  let calls = 0;
  const controller = createRuntimeRefresh(f.root, f.config, { collect: async () => { calls++; return seal(partial); }, reader: () => null, clock: f.clock });
  await assert.rejects(controller.refresh(f.input), /incomplete/);
  assert.equal(await readFile(f.file, "utf8"), before);
  await assert.rejects(controller.refresh({ ...f.input, kubeconfig: "/injected" }), /only/);
  assert.equal(calls, 1);
  await writeFile(f.file, JSON.stringify({ ...f.analysis, simulation: true }));
  await assert.rejects(controller.refresh(f.input), /Synthetic/);
  assert.equal(calls, 1);
});
test("concurrent refresh is bounded and changed baseline cannot be overwritten", async (t) => {
  const f = await fixture(t); let release, started;
  const entered = new Promise((r) => { started = r; });
  const blocked = new Promise((r) => { release = r; });
  const controller = createRuntimeRefresh(f.root, f.config, { collect: async () => { started(); await blocked; return f.capture; }, reader: () => null, clock: f.clock });
  const first = controller.refresh(f.input); await entered;
  await assert.rejects(controller.refresh(f.input), /in progress/);
  f.analysis.snapshots[0] = seal({ ...f.analysis.snapshots[0], newerBaseline: true });
  await writeFile(f.file, JSON.stringify(f.analysis));
  release(); await assert.rejects(first, /baseline changed during/);
  assert.deepEqual(JSON.parse(await readFile(f.file, "utf8")), f.analysis);
});
test("one-shot collector honors cancellation before making any request", async () => {
  const abort = new AbortController(); abort.abort(); let calls = 0;
  await assert.rejects(collectRuntime({ environment: "qa", cluster: "test", context: "test", namespaces: ["qa"] },
    { signal: abort.signal, read: async () => { calls++; } }), /abort/i);
  assert.equal(calls, 0);
});
test("HTTP refresh requires localhost, explicit POST, same origin and per-server token", async (t) => {
  let calls = 0;
  const server = createExplorer(tmpdir(), { runtimeController: {
    describe: async () => ({ configured: true, targets: [] }),
    refresh: async (input) => { calls++; return { accepted: input.targetId }; },
  } });
  await listen(server, 0);
  t.after(() => new Promise((r) => { server.close(r); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(origin + "/api/runtime/targets")).json();
  assert.equal(calls, 0);
  assert.equal((await fetch(origin + "/api/runtime/refresh")).status, 405);
  const badHost = await new Promise((resolve, reject) => {
    const req = request(origin + "/api/runtime/targets", { headers: { Host: "hostile.example" } },
      (res) => { res.resume(); resolve(res.statusCode); }); req.on("error", reject); req.end();
  });
  assert.equal(badHost, 403);
  const options = { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Archi-Runtime-Token": token }, body: JSON.stringify({ targetId: "qa" }) };
  assert.equal((await fetch(origin + "/api/runtime/refresh", { ...options, headers: { ...options.headers, Origin: "https://hostile.example" } })).status, 403);
  assert.equal((await fetch(origin + "/api/runtime/refresh", { ...options, headers: { ...options.headers, "X-Archi-Runtime-Token": "wrong" } })).status, 403);
  assert.equal(calls, 0);
  assert.equal((await fetch(origin + "/api/runtime/refresh", options)).status, 200);
  assert.equal(calls, 1);
});
