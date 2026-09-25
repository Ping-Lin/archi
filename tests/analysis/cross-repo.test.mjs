import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createCrossRepoFixture } from "../../scripts/cross-repo-fixture.mjs";
import { validateSystem } from "../../src/analysis/system-contract.mjs";
import { captureSystem } from "../../src/analysis/repositories.mjs";
import { analyzeSystem } from "../../src/analysis/system-run.mjs";
import { checkOracle } from "../../src/analysis/run.mjs";
import {
  validateAdapterResult,
  runAdapter,
} from "../../src/analysis/adapters.mjs";
import { projectServiceGraph } from "../../web/analysis-graph.mjs";
import {deploymentResolver} from '../../src/analysis/bindings.mjs';
import {createLedger} from '../../src/analysis/contract.mjs';

let parent, fixture, baseline;
let available = true;
try {
  execFileSync(process.env.HELM_BIN ?? "helm", ["version", "--short"], {
    stdio: "ignore",
  });
} catch {
  available = false;
}
if (process.env.CI && !available)
  throw Error("Helm required for cross-repository gate");
const options = { asOf: "2026-09-18T00:00:00Z" };
before(async () => {
  parent = await mkdtemp(path.join(os.tmpdir(), "archi-cross-test-"));
  fixture = await createCrossRepoFixture(path.join(parent, "system"));
  if (available)
    baseline = await analyzeSystem(fixture.root, "system.json", options);
});
after(async () => {
  await rm(parent, { recursive: true, force: true });
});
async function altered(edit) {
  const config = structuredClone(fixture.manifest);
  edit(config);
  await writeFile(
    path.join(fixture.root, "variant.json"),
    JSON.stringify(config),
  );
  return analyzeSystem(fixture.root, "variant.json", options);
}
const candidate = (result, source, name = "downstream", env = "qa") =>
  result.snapshots
    .find((s) => s.environment === env)
    .candidates.find((c) => c.source === source && c.name === name);

test("system schema rejects unsafe references, unpinned revisions and mixed identities", () => {
  validateSystem(fixture.manifest);
  for (const edit of [
    (m) => (m.repositories[0].revision = "main"),
    (m) => (m.services[0].source.files[0].path = "../outside"),
    (m) => (m.services[0].source.files[0].repository = "missing"),
    (m) => (m.services[0].project = "missing"),
    (m) => (m.services[0].source.adapter = "custom-script"),
    (m) => m.environments[0].instances.push(m.environments[0].instances[0]),
    (m) => (m.environments[0].externalTargets[0].id = "portal"),
    (m) => (m.environments[0].releases[0].extra = true),
    (m) => (m.environments[0].releases[0].namespace = 'invalid|scope'),
  ]) {
    const m = structuredClone(fixture.manifest);
    edit(m);
    assert.throws(() => validateSystem(m));
  }
  assert.throws(
    () => runAdapter("arbitrary-module", {}),
    /Unsupported adapter/,
  );
  assert.throws(
    () =>
      validateAdapterResult("spring-explicit-bean/1", {
        candidates: [],
        diagnostics: [],
      }),
    /Invalid adapter/,
  );
});
test("capture rejects a non-root repository and missing pinned files", async () => {
  const manifest = structuredClone(fixture.manifest);
  manifest.repositories.find((r) => r.id === "deploy").path = "deploy/chart";
  await writeFile(
    path.join(fixture.root, "bad-root.json"),
    JSON.stringify(manifest),
  );
  await assert.rejects(
    captureSystem(fixture.root, "bad-root.json"),
    /must name its root/,
  );
  manifest.repositories.find((r) => r.id === "deploy").path = "deploy";
  manifest.services[0].source.files[0].path = "missing.java";
  await writeFile(
    path.join(fixture.root, "missing.json"),
    JSON.stringify(manifest),
  );
  await assert.rejects(
    captureSystem(fixture.root, "missing.json"),
    /Missing or unsupported Git input/,
  );
});
test("system input mode is explicit and participates in capture hashes", {skip:!available}, async()=>{
  // Contract regression only: these source specimens remain synthetic test data.
  const changed=await altered(m=>{m.simulation=false;});
  assert.equal(changed.simulation,false);
  assert.notEqual(changed.snapshots[0].contentHash,baseline.snapshots[0].contentHash);
  assert.notEqual(changed.snapshots[0].inputLock.manifestHash,baseline.snapshots[0].inputLock.manifestHash);
  assert.deepEqual(changed.snapshots[0].dependencies.map(d=>[d.source,d.target,d.protocol]),baseline.snapshots[0].dependencies.map(d=>[d.source,d.target,d.protocol]));
});
test(
  "independent repositories match the handwritten oracle and keep same-name instances distinct",
  { skip: !available },
  async () => {
    await checkOracle(
      baseline,
      new URL("../fixtures/cross-repo-oracle.json", import.meta.url),
    );
    const s = baseline.snapshots[0];
    assert.equal(Object.keys(s.inputLock.revisionVector).length, 4);
    assert.equal(
      s.resources.filter((r) => r.kind === "Service" && r.name === "api")
        .length,
      4,
    );
    assert.equal(candidate(baseline, "portal").target, "orders");
    assert.equal(candidate(baseline, "orders").target, "inventory");
    assert.equal(candidate(baseline, "orders-shadow").sourceService, "orders");
    assert.notEqual(
      candidate(baseline, "orders").id,
      candidate(baseline, "orders-shadow").id,
    );
    assert.equal(
      s.dependencies.find((e) => e.source === "portal" && e.target === "orders")
        .targetProject,
      "sales",
    );
    assert.ok(
      s.resolutions.every((r) => r.version === "deployment-endpoint/1"),
    );
    const methods = s.evidence.filter(
      (e) => e.type === "code_static_analysis" && e.parentEvidenceId,
    );
    assert.ok(methods.length >= 7);
    assert.ok(methods.every((e) => e.provenance?.revision));
    assert.ok(s.candidates.every((c) => c.runtimeSupport === "unavailable"));
    assert.equal(
      projectServiceGraph(s).nodes.filter((n) =>
        ["orders", "orders-shadow"].includes(n.id),
      ).length,
      2,
    );
  },
);
test(
  "repeated runs and caller-specific environment policies are deterministic and isolated",
  { skip: !available },
  async () => {
    const repeat = await analyzeSystem(fixture.root, "system.json", {
      asOf: "2026-09-19T00:00:00Z",
    });
    assert.deepEqual(
      repeat.snapshots.map((s) => s.contentHash),
      baseline.snapshots.map((s) => s.contentHash),
    );
    const changed = await altered(
      (m) => (m.environments[0].instances[0].propertiesComplete = false),
    );
    assert.equal(candidate(changed, "portal").eligibility, "unknown");
    assert.equal(candidate(changed, "orders").eligibility, "enabled");
    assert.equal(
      changed.snapshots[1].contentHash,
      baseline.snapshots[1].contentHash,
    );
  },
);
test(
  "missing bindings and cross-cluster DNS do not create inferred edges",
  { skip: !available },
  async () => {
    const missing = await altered(
      (m) =>
        (m.environments[0].instances.find(
          (i) => i.id === "inventory",
        ).workload = "absent"),
    );
    assert.equal(candidate(missing, "orders").targetResolution, "unresolved");
    assert.equal(candidate(missing, "inventory").eligibility, "unknown");
    const cluster = await altered(
      (m) =>
        (m.environments[0].releases.find((r) => r.id === "orders").cluster =
          "isolated"),
    );
    assert.equal(candidate(cluster, "portal").targetResolution, "unresolved");
  },
);
test('rendered selectors and TCP transport must substantiate an internal binding',{skip:!available},()=>{
  const env=fixture.manifest.environments[0],caller=env.instances[0];
  for(const change of [r=>r.spec.selector={app:'wrong'},r=>r.spec.ports[0].protocol='UDP']){
    const resources=structuredClone(baseline.snapshots[0].resources);
    change(resources.find(r=>r.releaseId==='orders'&&r.kind==='Service'));
    const resolve=deploymentResolver({env,caller,resources,manifestHash:'test'});
    const result=resolve('http://api.sales-qa.svc.cluster.local:8080',createLedger('qa','portal'));
    assert.equal(result.matches.length,0);assert.match(result.reasons.join(' '),/selector evidence/);
  }
});
test(
  "ambiguous endpoint aliases preserve alternatives and do not produce an edge",
  { skip: !available },
  async () => {
    const result = await altered((m) =>
      m.environments[0].externalTargets.push({
        id: "unverified-alias",
        url: "http://api.sales-qa.svc.cluster.local:8080",
      }),
    );
    const c = candidate(result, "portal");
    assert.equal(c.targetResolution, "ambiguous");
    assert.deepEqual(c.alternatives, ["orders", "unverified-alias"]);
    assert.ok(
      !result.snapshots[0].dependencies.some((e) => e.candidateId === c.id),
    );
  },
);
test(
  "independent releases cannot silently claim the same rendered resource",
  { skip: !available },
  async () => {
    await assert.rejects(
      altered(
        (m) =>
          (m.environments[0].releases.find((r) => r.id === "shadow").namespace =
            "sales-qa"),
      ),
      /multiple releases/,
    );
  },
);
test(
  "dirty source bytes are ignored; advancing one pinned repository changes only its revision entry",
  { skip: !available },
  async () => {
    const file = path.join(fixture.root, "orders/Clients.java");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "new RemoteClient(url)",
        "new RemoteClient(url.trim())",
      ),
    );
    const dirty = await analyzeSystem(fixture.root, "system.json", options);
    assert.deepEqual(
      dirty.snapshots.map((s) => s.contentHash),
      baseline.snapshots.map((s) => s.contentHash),
    );
    const git = (args) =>
      execFileSync("git", ["-C", path.join(fixture.root, "orders"), ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Fixture",
          GIT_AUTHOR_EMAIL: "f@example.invalid",
          GIT_COMMITTER_NAME: "Fixture",
          GIT_COMMITTER_EMAIL: "f@example.invalid",
        },
      });
    git(["add", "Clients.java"]);
    git([
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "Unsupported constructor",
    ]);
    const revision = git(["rev-parse", "HEAD"]).trim();
    const changed = await altered(
      (m) =>
        (m.repositories.find((r) => r.id === "orders").revision = revision),
    );
    assert.equal(candidate(changed, "orders").eligibility, "unknown");
    assert.equal(candidate(changed, "portal").target, "orders");
    for (const [id, sha] of Object.entries(
      baseline.snapshots[0].inputLock.revisionVector,
    ))
      assert.equal(
        changed.snapshots[0].inputLock.revisionVector[id],
        id === "orders" ? revision : sha,
      );
  },
);
