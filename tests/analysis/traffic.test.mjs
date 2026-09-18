import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeTraffic, queryFor } from "../../src/traffic/model.mjs";
import { trafficFixture } from "../../examples/traffic/fixture.mjs";

function snapshot() {
  return {
    environment: "qa",
    contentHash: "static-lock",
    instances: [
      ["portal", "experience-qa"],
      ["orders", "sales-qa"],
      ["inventory", "stock-qa"],
      ["orders-shadow", "sandbox-qa"],
    ].map(([id, namespace]) => ({
      id,
      workload: "api",
      scope: { cluster: "commerce", namespace },
    })),
    dependencies: [
      { id: "a", source: "portal", target: "orders", protocol: "HTTP" },
      { id: "b", source: "orders", target: "inventory", protocol: "HTTP" },
      {
        id: "c",
        source: "orders-shadow",
        target: "inventory",
        protocol: "HTTP",
      },
    ],
  };
}
const run = (bundle = trafficFixture(), s = snapshot()) =>
  analyzeTraffic(bundle, s);
const edge = (report, source, target) =>
  report.edges.find((e) => e.source === source && e.target === target);
const rows = (b) => b.sources[0].payload.response.data.result;
const spans = (b) => b.sources[1].payload.resourceSpans;

test("traffic CLI preserves snapshots and other captures, and fails before overwrite", async () => {
  const root=await mkdtemp(path.join(tmpdir(),'archi-traffic-test-'));
  const input=path.join(root,'analysis.json'),bundle=path.join(root,'bundle.json'),output=path.join(root,'output.json');
  const analysis={simulation:true,snapshots:[snapshot()],traffic:{production:{marker:'unchanged'}}};
  try {
    await writeFile(input,JSON.stringify(analysis));
    await writeFile(bundle,JSON.stringify(trafficFixture()));
    const args=['scripts/traffic.mjs','--analysis',input,'--bundle',bundle,'--out',output];
    const invoke=()=>execFileSync(process.execPath,args,{cwd:new URL('../..',import.meta.url),stdio:'pipe'});
    invoke();
    const result=JSON.parse(await readFile(output,'utf8'));
    assert.deepEqual(result.snapshots,analysis.snapshots);
    assert.deepEqual(result.traffic.production,analysis.traffic.production);
    assert.equal(result.traffic.qa.edges.length,4);
    const before=await readFile(output,'utf8');
    const live=trafficFixture();live.simulation=false;await writeFile(bundle,JSON.stringify(live));
    assert.throws(invoke,/synthetic and real/);
    assert.equal(await readFile(output,'utf8'),before);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("traffic reconciles independently authored counts and scoped relationships", () => {
  const b = trafficFixture(),
    s = snapshot(),
    before = structuredClone(s),
    r = run(b, s);
  assert.deepEqual(s, before, "static snapshot must not be mutated");
  const e = edge(r, "portal", "orders");
  assert.equal(e.requestCount, 300);
  assert.equal(e.rps, 1);
  assert.equal(e.errorRate, 0.05);
  assert.equal(e.status, "supported");
  assert.equal(e.traceSamples.length, 1);
  assert.equal(e.traceSamples[0].durationMs, 25);
  assert.equal(edge(r, "portal", "inventory").status, "observed-only");
  assert.equal(edge(r, "orders-shadow", "inventory").status, "not-observed");
  assert.equal(edge(r, "orders-shadow", "inventory").errorRate, null);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.unresolved[0].source.status, "unmapped");
  assert.equal(r.diagnostics[0].code, "unpaired-server-span");
  assert.equal(r.releaseCorrespondence, "unverified");
  assert.equal(r.staticContentHash, "static-lock");
  assert.deepEqual(run(b, s), r);
});

test("rejects cross-environment and malformed envelopes", () => {
  const b = trafficFixture();
  b.environment = "production";
  assert.throws(() => run(b), /environment mismatch/);
  b.environment = "qa";
  b.extra = true;
  assert.throws(() => run(b), /additional/);
  delete b.extra;
  b.window.end = b.window.start;
  assert.throws(() => run(b), /window/);
});

test("does not map by workload name alone or collapse ambiguous identities", () => {
  const b = trafficFixture(),
    s = snapshot();
  delete rows(b)[0].metric.source_cluster;
  s.instances.push({ ...s.instances[1], id: "orders-copy" });
  const r = run(b, s);
  assert.ok(r.unresolved.some((o) => o.source.status === "unmapped"));
  assert.ok(
    r.unresolved.some(
      (o) =>
        o.target.status === "ambiguous" && o.target.candidates.length === 2,
    ),
  );
  assert.equal(edge(r, "portal", "orders").status, "not-observed");
});

test("rejects wrong reporter, query, timestamps, dimensions and duplicate metric series", () => {
  for (const mutate of [
    (b) => {
      rows(b)[0].metric.reporter = "source";
    },
    (b) => {
      b.sources[0].payload.query = "sum(istio_requests_total)";
    },
    (b) => {
      rows(b)[0].value[0] -= 1;
    },
    (b) => {
      rows(b)[0].value[1] = "NaN";
    },
    (b) => {
      rows(b)[0].metric.pod = "extra";
    },
    (b) => {
      rows(b).push(structuredClone(rows(b)[0]));
    },
    (b) => {
      b.sources.push({ ...b.sources[0], id: "second-backend" });
    },
  ]) {
    const b = trafficFixture();
    mutate(b);
    assert.throws(() => run(b), /Traffic:/);
  }
});

test("unknown status suppresses error rate; gRPC uses its own status", () => {
  const b = trafficFixture();
  delete rows(b)[0].metric.response_code;
  assert.equal(edge(run(b), "portal", "orders").errorRate, null);
  const g = trafficFixture();
  g.sources.pop();
  for (const r of rows(g)) {
    r.metric.request_protocol = "grpc";
    r.metric.grpc_response_status =
      r.metric.response_code === "503" ? "8" : "0";
  }
  assert.equal(edge(run(g), "portal", "orders").protocol, "gRPC");
  assert.equal(edge(run(g), "portal", "orders").errorRate, 0.05);
});

test("unavailable, empty and partial captures make no absence claim", () => {
  const b = trafficFixture();
  b.sources = [];
  assert.ok(run(b).edges.every((e) => e.status === "insufficient-evidence"));
  b.sources = trafficFixture().sources.map((s) => ({
    ...s,
    coverage: "unavailable",
    payload: {},
  }));
  assert.ok(run(b).edges.every((e) => e.status === "insufficient-evidence"));
  b.sources[0].payload = { unexpected: true };
  assert.throws(() => run(b), /unavailable/);
  const empty = trafficFixture();
  empty.sources.pop();
  rows(empty).length = 0;
  assert.ok(run(empty).edges.every((e) => e.status === "not-observed"));
});

test("duplicate spans are deduplicated and conflicting copies rejected", () => {
  const b = trafficFixture();
  spans(b).push(structuredClone(spans(b)[1]));
  assert.equal(edge(run(b), "portal", "orders").traceSamples.length, 1);
  spans(b).at(-1).scopeSpans[0].spans[0].endTimeUnixNano =
    "1789725720050000000";
  assert.throws(() => run(b), /conflicting duplicate/);
});

test("span identity and time boundaries are validated, no same-trace guessing", () => {
  const b = trafficFixture();
  spans(b)[1].scopeSpans[0].spans[0].parentSpanId = "6666666666666666";
  assert.equal(edge(run(b), "portal", "orders").traceSamples.length, 0);
  const atEnd = trafficFixture(),
    span = spans(atEnd)[1].scopeSpans[0].spans[0];
  span.startTimeUnixNano = span.endTimeUnixNano = String(
    BigInt(Date.parse(atEnd.window.end)) * 1000000n,
  );
  assert.equal(edge(run(atEnd), "portal", "orders").traceSamples.length, 0);
  span.traceId = "not-an-id";
  assert.throws(() => run(atEnd), /trace\/span ID/);
});

test("changing evidence changes report identity without changing static identity", () => {
  const b = trafficFixture(),
    original = run(b);
  rows(b)[0].value[1] = "286";
  const changed = run(b);
  assert.notEqual(changed.inputHash, original.inputHash);
  assert.notEqual(changed.contentHash, original.contentHash);
  assert.notEqual(changed.evidence[0].id, original.evidence[0].id);
  assert.equal(changed.staticContentHash, original.staticContentHash);
});

test("trace-only evidence never becomes request volume or a latency percentile", () => {
  const b = trafficFixture();
  b.sources.shift();
  b.sources.push({ ...structuredClone(b.sources[0]), id: "duplicate-export" });
  const e = edge(run(b), "portal", "orders");
  assert.equal(e.requestCount, null);
  assert.equal(e.rps, null);
  assert.equal(e.errorRate, null);
  assert.equal(e.traceSamples.length, 1);
  assert.equal(e.status, "supported");
  assert.throws(() => queryFor(0.5), /whole seconds/);
});
