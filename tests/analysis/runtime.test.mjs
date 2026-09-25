import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VERSION } from "../../src/analysis/contract.mjs";
import {
  runtimeFixture,
  specimen,
  CAPTURE_AT,
} from "../../examples/runtime/fixture.mjs";
import { reconcileRuntime } from "../../src/runtime/reconcile.mjs";
import {
  seal,
  validateCapture,
  projectResource,
} from "../../src/runtime/contract.mjs";
import { collectRuntime, kubectlReader } from "../../src/runtime/collect.mjs";
import { importRuntime } from "../../src/runtime/import.mjs";
import { importTraffic } from "../../src/traffic/import.mjs";
import { trafficFixture } from "../../examples/traffic/fixture.mjs";
import { createJson } from "../../src/observations/create.mjs";
import { displayFreshness } from "../../web/runtime-view.mjs";

function snapshot(environment = "qa") {
  const instances = [
    ["portal", "experience-qa"],
    ["orders", "sales-qa"],
    ["inventory", "stock-qa"],
    ["orders-shadow", "sandbox-qa"],
  ].map(([id, namespace]) => ({
    id,
    workload: "api",
    scope: { cluster: "commerce", namespace },
  }));
  return seal({
    schemaVersion: VERSION,
    environment,
    instances,
    dependencies: [],
    candidates: [],
    facts: [],
    resolutions: [],
    evidence: [{ id: "render", environment }],
    resources: instances.map((i) => ({
      key: ["commerce", "apps", "deployments", i.scope.namespace, "api"].join(
        "|",
      ),
      kind: "Deployment",
      evidenceId: "render",
      spec: {
        template: {
          spec: {
            containers: [
              { name: "app", image: `example.invalid/${i.id}:synthetic` },
            ],
          },
        },
      },
    })),
  });
}
const options = { assessedAt: CAPTURE_AT, ttlSeconds: 300 };
const run = (c = runtimeFixture(), s = snapshot(), opts = options) =>
  reconcileRuntime(s, seal(c), opts);
const finding = (r, id) => r.findings.find((f) => f.instanceId === id);
const collection = (c, kind = "Deployment", ns = "sales-qa") =>
  c.collections.find((x) => x.kind === kind && x.namespace === ns);

test("three-state comparison keeps rollout, reference difference and availability independent", () => {
  const s = snapshot(),
    before = structuredClone(s),
    report = run(runtimeFixture(), s),
    f = finding(report, "orders");
  assert.equal(f.specAlignment, "different");
  assert.equal(f.rollout, "progressing");
  assert.equal(f.availability, "available");
  assert.equal(f.pods.length, 3);
  assert.equal(f.classification, "information");
  assert.equal(f.consistency.status, "no-discrepancy-detected");
  assert.ok(f.reasonCodes.includes("mixed-pod-image-references"));
  assert.equal(finding(report, "portal").specAlignment, "matching");
  assert.equal(finding(report, "portal").imageIdentity, "unverified");
  assert.equal(finding(report, "inventory").presence, "absent");
  assert.equal(finding(report, "orders-shadow").presence, "unknown");
  assert.deepEqual(s, before);
  assert.deepEqual(report, run(runtimeFixture(), s));
  for (const f of report.findings)
    for (const id of f.evidenceIds)
      assert.ok(report.evidence.some((e) => e.id === id));
  assert.ok(report.evidence.some((e) => e.kind === "ReplicaSet" && e.uid));
  assert.ok(report.evidence.some((e) => e.kind === "Pod" && e.uid));
});
test("partial, failed and uncollected namespaces cannot establish absence", () => {
  const c = runtimeFixture();
  collection(c, "Deployment", "stock-qa").status = "partial";
  collection(c, "Deployment", "stock-qa").reason = "query-failed";
  assert.equal(finding(run(c), "inventory").presence, "unknown");
  c.collections = c.collections.filter((x) => x.namespace !== "stock-qa");
  assert.ok(
    finding(run(c), "inventory").reasonCodes.includes(
      "namespace-not-collected",
    ),
  );
  c.collections = c.collections.filter((x) => x.kind !== "Pod");
  assert.equal(finding(run(c), "orders").podCoverage, "partial");
});
test("freshness is orthogonal, explicit, and continues to expire in the browser", () => {
  const r = run(),
    f = finding(r, "orders");
  assert.equal(f.freshness, "fresh");
  assert.equal(
    displayFreshness(r, f, Date.parse(CAPTURE_AT) + 301000),
    "stale",
  );
  assert.equal(
    finding(
      run(runtimeFixture(), snapshot(), { assessedAt: "2026-09-24T13:00:00Z" }),
      "orders",
    ).freshness,
    "stale",
  );
  assert.equal(
    finding(
      run(runtimeFixture(), snapshot(), { assessedAt: "2026-09-24T11:00:00Z" }),
      "orders",
    ).freshness,
    "unknown",
  );
  assert.throws(
    () =>
      run(runtimeFixture(), snapshot(), {
        assessedAt: CAPTURE_AT,
        ttlSeconds: 0,
      }),
    /TTL/,
  );
});
test("ownership uses UID and kind, never names or labels", () => {
  const c = runtimeFixture();
  collection(c).resources[0].uid = "recreated-deployment";
  assert.equal(finding(run(c), "orders").pods.length, 0);
  const r = runtimeFixture();
  collection(r, "Pod").resources[0].owners[0].kind = "Deployment";
  assert.equal(finding(run(r), "orders").pods.length, 2);
});
test("unbound inventory stays separate from static architecture", () => {
  const c = runtimeFixture();
  collection(c).resources.push(
    specimen("Deployment", "sales-qa", "worker", "unbound"),
  );
  const report = run(c);
  assert.equal(report.findings.filter((f) => f.instanceId === null).length, 1);
  assert.deepEqual(snapshot().dependencies, []);
  c.cluster = "another-cluster";
  assert.throws(() => run(c), /cluster not bound/);
  c.cluster = "commerce";
  c.environment = "production";
  assert.throws(() => run(c), /environment mismatch/);
});
test("controller generation, zero replicas, paused and failed progress remain explicit", () => {
  for (const [edit, expected] of [
    [
      (d) => {
        d.observedGeneration = 1;
      },
      { availability: "unknown", rollout: "unknown" },
    ],
    [
      (d) => {
        d.replicas = 0;
      },
      { availability: "scaled-to-zero", rollout: "unknown" },
    ],
    [
      (d) => {
        d.paused = true;
      },
      { availability: "available", rollout: "paused" },
    ],
    [
      (d) => {
        d.availableReplicas = 0;
      },
      { availability: "unavailable", rollout: "progressing" },
    ],
    [
      (d) => {
        d.conditions[0].status = "False";
      },
      { availability: "available", rollout: "unknown" },
    ],
    [
      (d) => {
        d.terminating = true;
      },
      { availability: "unknown", rollout: "unknown" },
    ],
  ]) {
    const c = runtimeFixture();
    edit(collection(c).resources[0]);
    const f = finding(run(c), "orders");
    for (const [k, v] of Object.entries(expected)) assert.equal(f[k], v);
  }
});
test("capture and static integrity checks reject stale hashes, malformed identities and extra fields", () => {
  const c = runtimeFixture();
  c.cluster = "tampered";
  assert.throws(() => validateCapture(c), /hash/);
  for (const edit of [
    (c) => {
      collection(c).resources[0].annotations = { secret: "x" };
    },
    (c) => {
      collection(c).resources[0].namespace = "foreign";
    },
    (c) => {
      collection(c).resources[0].replicas = "2";
    },
    (c) => {
      c.collections.push(c.collections[0]);
    },
    (c) => {
      collection(c).resources.push(collection(c).resources[0]);
    },
    (c) => {
      collection(c).selector = "app=api";
    },
    (c) => {
      collection(c).finishedAt = "2026-09-24T14:00:00Z";
    },
  ]) {
    const c = runtimeFixture();
    edit(c);
    assert.throws(() => run(c));
  }
  const s = snapshot();
  s.resources[0].spec.template.spec.containers[0].image = "changed";
  assert.throws(() => run(runtimeFixture(), s), /hash/);
});
function page(kind, items = [], continuation = "", rv = "10") {
  return JSON.stringify({
    kind: kind + "List",
    metadata: { resourceVersion: rv, continue: continuation },
    items,
  });
}
function rawDeployment() {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "api",
      namespace: "sales-qa",
      uid: "d",
      resourceVersion: "10",
      generation: 1,
      annotations: { secret: "token" },
    },
    spec: {
      replicas: 1,
      template: {
        spec: {
          containers: [
            {
              name: "app",
              image: "example.invalid/app:v1",
              env: [{ name: "PASSWORD", value: "secret" }],
              command: ["secret"],
            },
          ],
        },
      },
    },
    status: {
      observedGeneration: 1,
      readyReplicas: 1,
      availableReplicas: 1,
      updatedReplicas: 1,
      replicas: 1,
      conditions: [
        {
          type: "Available",
          status: "True",
          reason: "MinimumReplicasAvailable",
          message: "token",
        },
      ],
    },
  };
}
const config = {
  environment: "qa",
  cluster: "commerce",
  context: "explicit",
  namespaces: ["sales-qa"],
};
const kindFor = (url) =>
  url.includes("/deployments?")
    ? "Deployment"
    : url.includes("/replicasets?")
      ? "ReplicaSet"
      : "Pod";
test("collector follows pagination, projects allowlisted fields and sanitizes failures", async () => {
  const urls = [];
  const capture = await collectRuntime(config, {
    read: async (url) => {
      urls.push(url);
      const k = kindFor(url);
      if (k === "Pod") throw Error("Bearer secret");
      return page(
        k,
        k === "Deployment" && !url.includes("continue=")
          ? [rawDeployment()]
          : [],
        k === "Deployment" && !url.includes("continue=") ? "next/+ token" : "",
      );
    },
    clock: () => Date.parse(CAPTURE_AT),
  });
  assert.equal(capture.simulation, false);
  assert.equal(capture.collections[0].status, "complete");
  assert.equal(capture.collections[2].status, "failed");
  assert.ok(urls[1].includes("continue=next%2F%2B+token"));
  assert.ok(!JSON.stringify(capture).includes("secret"));
  assert.ok(!JSON.stringify(capture).includes("PASSWORD"));
  assert.ok(!JSON.stringify(capture).includes("message"));
  assert.equal(
    capture.collections[0].resources[0].containers[0].image,
    "example.invalid/app:v1",
  );
});
test("incomplete pagination and snapshot-version changes never claim complete coverage", async () => {
  for (const failure of ["throw", "version", "repeat"]) {
    let n = 0;
    const c = await collectRuntime(config, {
      read: async (url) => {
        const k = kindFor(url);
        if (k !== "Deployment") return page(k);
        n++;
        if (n === 1) return page(k, [rawDeployment()], "more");
        if (failure === "throw") throw Error("expired");
        return page(k, [], "more", failure === "version" ? "11" : "10");
      },
      clock: () => Date.parse(CAPTURE_AT),
    });
    assert.equal(c.collections[0].status, "partial");
    assert.equal(c.collections[0].resources.length, 1);
  }
});
test("collection deadlines and invalid resource types fail closed", async () => {
  let t = 0;
  const c = await collectRuntime(config, {
    read: async () => {
      throw Error("should not query");
    },
    clock: () => Date.parse(CAPTURE_AT) + (t++ ? 200000 : 0),
  });
  assert.ok(
    c.collections.every(
      (x) => x.status === "failed" && x.reason === "deadline-exceeded",
    ),
  );
  assert.throws(() =>
    projectResource(
      { ...rawDeployment(), kind: "Secret" },
      "Deployment",
      "sales-qa",
    ),
  );
  await assert.rejects(
    () =>
      collectRuntime(
        { ...config, namespaces: ["../outside"] },
        { read: async () => "" },
      ),
    /namespace/,
  );
});
test("kubectl failures never disclose stderr or credentials", async () => {
  const read = kubectlReader({
    context: "test",
    kubeconfig: "/not-used",
    binary: "/not-a-real-binary",
  });
  await assert.rejects(
    () => read("/api/v1/namespaces/ns/pods", 100),
    /^Error: query-failed$/,
  );
});
test("kubectl transport passes explicit context and fixed read path as literal arguments", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "archi-kubectl-"));
  const binary = path.join(dir, "kubectl-test");
  try {
    await writeFile(
      binary,
      "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
      { mode: 0o700 },
    );
    const read = kubectlReader({
      context: "context with spaces",
      kubeconfig: "/approved/config with spaces",
      binary,
    });
    const url =
      "/apis/apps/v1/namespaces/ns/deployments?limit=500&continue=a%2Bb";
    const args = JSON.parse(await read(url, 2000));
    assert.deepEqual(args, [
      "--kubeconfig",
      "/approved/config with spaces",
      "--context",
      "context with spaces",
      "--request-timeout",
      "2s",
      "get",
      "--raw",
      url,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("runtime and traffic writers preserve independent overlays, hashes and cluster captures", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "archi-runtime-"));
  const analysis = path.join(dir, "analysis.json"),
    capture = path.join(dir, "capture.json"),
    bundle = path.join(dir, "traffic.json");
  const s = snapshot();
  s.instances.push({
    id: "other",
    workload: "api",
    scope: { cluster: "other", namespace: "sales-qa" },
  });
  const data = {
    schemaVersion: VERSION,
    simulation: true,
    snapshots: [seal(s), snapshot("production")],
  };
  try {
    await writeFile(analysis, JSON.stringify(data));
    await writeFile(capture, JSON.stringify(runtimeFixture()));
    await writeFile(bundle, JSON.stringify(trafficFixture()));
    await importRuntime({ analysis, capture, out: analysis, ...options });
    await importTraffic({ analysis, bundle, out: analysis });
    const before = JSON.parse(await readFile(analysis, "utf8"));
    const second = runtimeFixture();
    second.cluster = "other";
    await writeFile(capture, JSON.stringify(seal(second)));
    await importRuntime({ analysis, capture, out: analysis, ...options });
    const after = JSON.parse(await readFile(analysis, "utf8"));
    assert.equal(after.runtime.qa.reports.length, 2);
    assert.deepEqual(after.snapshots, data.snapshots);
    assert.deepEqual(after.traffic, before.traffic);
    const saved = await readFile(analysis, "utf8");
    second.simulation = false;
    await writeFile(capture, JSON.stringify(seal(second)));
    await assert.rejects(
      () => importRuntime({ analysis, capture, out: analysis, ...options }),
      /synthetic and real/,
    );
    assert.equal(await readFile(analysis, "utf8"), saved);
    await writeFile(analysis + ".lock", "other owner");
    await assert.rejects(
      () => importRuntime({ analysis, capture, out: analysis, ...options }),
      /locked/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("new captures cannot overwrite existing files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "archi-create-")),
    file = path.join(dir, "capture.json");
  try {
    await createJson(file, runtimeFixture());
    const before = await readFile(file, "utf8");
    await assert.rejects(() => createJson(file, {}), /EEXIST/);
    assert.equal(await readFile(file, "utf8"), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
