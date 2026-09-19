import Ajv from "ajv";
import { hash } from "../analysis/contract.mjs";
import {
  insist,
  boundedJson,
  validateSnapshot,
  nanos,
  timestamp,
  LIMITS,
} from "./validation.mjs";
import { validateOtlp } from "./otlp-schema.mjs";

const text = { type: "string", minLength: 1 };
const object = (properties) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
export const trafficBundleSchema = object({
  schemaVersion: { const: "archi/traffic-v1alpha1" },
  simulation: { type: "boolean" },
  environment: text,
  window: object({ start: text, end: text }),
  sources: {
    type: "array",
    maxItems: LIMITS.sources,
    items: object({
      id: text,
      adapter: { enum: ["istio-prometheus/1", "otlp-json/2"] },
      correlationScope: { type: "string", minLength: 1, maxLength: 128 },
      coverage: { enum: ["available", "partial", "unavailable"] },
      note: text,
      sampling: { enum: ["none", "sampled", "unknown"] },
      payload: { type: "object" },
    }),
  },
});
// Metrics do not require trace scope; OTLP /2 explicitly declares its join boundary.
trafficBundleSchema.properties.sources.items.required =
  trafficBundleSchema.properties.sources.items.required.filter(
    (k) => k !== "correlationScope",
  );
const validate = new Ajv({ allErrors: true }).compile(trafficBundleSchema);
export function queryFor(seconds) {
  insist(
    Number.isInteger(seconds) && seconds > 0,
    "window must use positive whole seconds",
  );
  return `sum by (reporter,source_cluster,source_workload_namespace,source_workload,destination_cluster,destination_workload_namespace,destination_workload,request_protocol,response_code,grpc_response_status) (increase(istio_requests_total{reporter="destination"}[${seconds}s]))`;
}
const key = (a, b, p) => JSON.stringify([a, b, p]);
const protocol = (p) =>
  p === "grpc" ? "gRPC" : ["http", "http2"].includes(p) ? "HTTP" : null;
function resolve(identity, snapshot) {
  const candidates = (snapshot.instances ?? [])
    .filter(
      (i) =>
        identity.cluster &&
        identity.namespace &&
        identity.workload &&
        i.scope.cluster === identity.cluster &&
        i.scope.namespace === identity.namespace &&
        i.workload === identity.workload,
    )
    .map((i) => i.id)
    .sort();
  return {
    identity,
    status:
      candidates.length === 1
        ? "unique"
        : candidates.length
          ? "ambiguous"
          : "unmapped",
    candidates,
    id: candidates.length === 1 ? candidates[0] : null,
  };
}
const metricIdentity = (labels, side) => ({
  cluster: labels[`${side}_cluster`] ?? null,
  namespace: labels[`${side}_workload_namespace`] ?? null,
  workload: labels[`${side}_workload`] ?? null,
});
function attrs(list = []) {
  insist(Array.isArray(list), "OTLP attributes array required");
  const result = Object.create(null);
  for (const a of list) {
    insist(
      a && typeof a.key === "string" && !Object.hasOwn(result, a.key),
      "duplicate or invalid OTLP attribute",
    );
    result[a.key] = a.value?.stringValue ?? a.value?.intValue ?? null;
  }
  return result;
}
function otelIdentity(a) {
  return {
    cluster: a["k8s.cluster.name"] ?? null,
    namespace: a["k8s.namespace.name"] ?? null,
    workload: a["k8s.deployment.name"] ?? null,
  };
}

export function analyzeTraffic(bundle, snapshot) {
  boundedJson(bundle);
  validateSnapshot(snapshot);
  insist(validate(bundle), JSON.stringify(validate.errors));
  insist(bundle.environment === snapshot.environment, "environment mismatch");
  insist(
    Array.isArray(snapshot.instances),
    "requires a system snapshot with instance bindings",
  );
  const start = timestamp(bundle.window.start),
    end = timestamp(bundle.window.end),
    seconds = (end - start) / 1000;
  insist(
    /(Z|[+-]\d\d:\d\d)$/.test(bundle.window.start) &&
      /(Z|[+-]\d\d:\d\d)$/.test(bundle.window.end) &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      seconds > 0,
    "invalid time window",
  );
  insist(
    new Set(bundle.sources.map((s) => s.id)).size === bundle.sources.length,
    "duplicate source ID",
  );
  insist(
    bundle.sources.filter((s) => s.adapter === "istio-prometheus/1").length <=
      1,
    "one authoritative metric source per window; do not sum backends",
  );
  const observations = [],
    diagnostics = [],
    evidence = [],
    evidenceById = new Map(),
    traceGroups = new Map(),
    inputHash = hash(bundle);
  let recordCount = 0;
  function add(source, index, from, to, p, measurement, reference) {
    const id = `traffic:${hash([inputHash, source.id, index]).slice(0, 24)}`;
    const record = {
      id,
      source: source.id,
      adapter: source.adapter,
      reference,
    };
    evidence.push(record);
    evidenceById.set(id, record);
    observations.push({
      id,
      source: resolve(from, snapshot),
      target: resolve(to, snapshot),
      protocol: p,
      measurement,
      evidenceId: id,
    });
  }
  for (const source of bundle.sources) {
    insist(
      source.adapter === "otlp-json/2"
        ? typeof source.correlationScope === "string"
        : source.correlationScope === undefined,
      "OTLP /2 requires correlationScope; metrics must omit it",
    );
    if (source.coverage === "unavailable") {
      insist(
        Object.keys(source.payload).length === 0,
        "unavailable source must not contain data",
      );
      continue;
    }
    if (source.adapter === "istio-prometheus/1") {
      insist(
        source.correlationScope === undefined,
        "correlationScope is only valid for OTLP",
      );
      const { query, response } = source.payload;
      insist(source.sampling === "none", "metrics sampling must be none");
      insist(
        query === queryFor(seconds),
        "unsupported metric query; preserve reporter, scope, protocol and status dimensions",
      );
      insist(
        response?.status === "success" &&
          response.data?.resultType === "vector" &&
          Array.isArray(response.data.result),
        "expected successful Prometheus instant vector",
      );
      if (response.warnings?.length || response.infos?.length)
        diagnostics.push({
          source: source.id,
          code: "backend-notices",
          details: [...(response.warnings ?? []), ...(response.infos ?? [])],
        });
      const seen = new Set();
      for (const [index, row] of response.data.result.entries()) {
        insist(++recordCount <= LIMITS.records, "record limit exceeded");
        insist(row && typeof row === "object", "metric row object required");
        const l = row.metric,
          value = Number(row.value?.[1]);
        insist(
          l && l.reporter === "destination",
          "destination reporter required",
        );
        const dimensions = [
          "reporter",
          "source_cluster",
          "source_workload_namespace",
          "source_workload",
          "destination_cluster",
          "destination_workload_namespace",
          "destination_workload",
          "request_protocol",
          "response_code",
          "grpc_response_status",
        ];
        insist(
          Object.keys(l).every(
            (k) => dimensions.includes(k) && typeof l[k] === "string",
          ),
          "unexpected metric dimensions",
        );
        insist(
          Array.isArray(row.value) &&
            row.value.length === 2 &&
            typeof row.value[1] === "string" &&
            /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(row.value[1]) &&
            Number.isFinite(value) &&
            value >= 0,
          "invalid request increase",
        );
        insist(
          Number.isFinite(row.value[0]) && row.value[0] * 1000 === end,
          "metric timestamp must equal window end",
        );
        const fingerprint = hash(l);
        insist(!seen.has(fingerprint), "duplicate metric series");
        seen.add(fingerprint);
        const p = protocol(l.request_protocol);
        if (!p) {
          diagnostics.push({
            source: source.id,
            code: "unsupported-protocol",
            index,
          });
          continue;
        }
        const status = p === "gRPC" ? l.grpc_response_status : l.response_code;
        const known =
          p === "gRPC"
            ? /^(?:[0-9]|1[0-6])$/.test(status ?? "")
            : /^[1-5]\d\d$/.test(status ?? "");
        add(
          source,
          index,
          metricIdentity(l, "source"),
          metricIdentity(l, "destination"),
          p,
          {
            kind: "requests",
            count: value,
            errors: known
              ? (p === "gRPC" ? Number(status) !== 0 : Number(status) >= 500)
                ? value
                : 0
              : null,
          },
          { resultIndex: index, labels: l },
        );
      }
    } else {
      insist(
        typeof source.correlationScope === "string",
        "OTLP /2 requires correlationScope",
      );
      validateOtlp(source.payload);
      insist(
        Array.isArray(source.payload.resourceSpans),
        "expected OTLP resourceSpans",
      );
      if (!traceGroups.has(source.correlationScope))
        traceGroups.set(source.correlationScope, new Map());
      const spans = traceGroups.get(source.correlationScope);
      for (const [
        resourceIndex,
        resource,
      ] of source.payload.resourceSpans.entries()) {
        insist(
          resource &&
            typeof resource === "object" &&
            Array.isArray(resource.scopeSpans),
          "resource scopeSpans array required",
        );
        const identity = otelIdentity(attrs(resource.resource?.attributes));
        for (const [scopeIndex, scope] of resource.scopeSpans.entries()) {
          insist(
            scope && Array.isArray(scope.spans),
            "scope spans array required",
          );
          for (const [spanIndex, span] of scope.spans.entries()) {
            insist(++recordCount <= LIMITS.records, "record limit exceeded");
            insist(span && typeof span === "object", "span object required");
            insist(
              /^[a-fA-F0-9]{32}$/.test(span.traceId) &&
                !/^0+$/.test(span.traceId) &&
                /^[a-fA-F0-9]{16}$/.test(span.spanId) &&
                !/^0+$/.test(span.spanId),
              "invalid trace/span ID",
            );
            insist(
              /^\d+$/.test(span.startTimeUnixNano) &&
                /^\d+$/.test(span.endTimeUnixNano),
              "invalid span timestamps",
            );
            insist(
              Number.isInteger(span.kind) && span.kind >= 0 && span.kind <= 5,
              "OTLP span kind must use numeric enum",
            );
            insist(
              !span.parentSpanId ||
                (/^[a-fA-F0-9]{16}$/.test(span.parentSpanId) &&
                  !/^0+$/.test(span.parentSpanId)),
              "invalid parent span ID",
            );
            const traceId = span.traceId.toLowerCase(),
              spanId = span.spanId.toLowerCase();
            const startNs = nanos(span.startTimeUnixNano),
              endNs = nanos(span.endTimeUnixNano);
            insist(endNs >= startNs, "negative span duration");
            const record = {
              ...span,
              traceId,
              spanId,
              parentSpanId: span.parentSpanId?.toLowerCase() ?? "",
              identity,
            };
            const id = `${traceId}/${spanId}`;
            const location = {
              source: source.id,
              resourceIndex,
              scopeIndex,
              spanIndex,
            };
            if (spans.has(id))
              insist(
                hash(spans.get(id).record) === hash(record),
                "conflicting duplicate span",
              );
            else spans.set(id, { record, source, locations: [] });
            spans.get(id).locations.push(location);
          }
        }
      }
    }
  }
  for (const [correlationScope, spans] of traceGroups) {
    for (const entry of spans.values()) {
      const { record: span, source } = entry;
      if (span.kind !== 2) continue; // OTLP numeric SERVER; only direct CLIENT -> SERVER pairs.
      const at = BigInt(span.startTimeUnixNano);
      if (at < BigInt(start) * 1000000n || at >= BigInt(end) * 1000000n)
        continue;
      const parentEntry = spans.get(`${span.traceId}/${span.parentSpanId}`),
        parent = parentEntry?.record;
      if (parent?.kind !== 3) {
        diagnostics.push({
          source: source.id,
          code: "unpaired-server-span",
          traceId: span.traceId,
          spanId: span.spanId,
        });
        continue;
      }
      const a = attrs(span.attributes),
        p =
          a["rpc.system"] === "grpc" || a["rpc.system.name"] === "grpc"
            ? "gRPC"
            : a["http.request.method"] || a["http.method"]
              ? "HTTP"
              : null;
      if (!p) {
        diagnostics.push({
          source: source.id,
          code: "unsupported-span-protocol",
          spanId: span.spanId,
        });
        continue;
      }
      add(
        source,
        `${span.traceId}/${span.spanId}`,
        parent.identity,
        span.identity,
        p,
        {
          kind: "trace",
          durationMs: Number(BigInt(span.endTimeUnixNano) - at) / 1e6,
        },
        {
          traceId: span.traceId,
          clientSpanId: parent.spanId,
          serverSpanId: span.spanId,
          correlationScope,
          clientRecords: parentEntry.locations,
          serverRecords: entry.locations,
        },
      );
    }
  }
  const edges = new Map(),
    sampleIds = new Set();
  const ensure = (from, to, p) => {
    const id = key(from, to, p);
    if (!edges.has(id))
      edges.set(id, {
        source: from,
        target: to,
        protocol: p,
        staticDependencyIds: [],
        evidenceIds: [],
        requestCount: null,
        errorCount: null,
        unknownStatusCount: 0,
        traceSamples: [],
        observed: false,
      });
    return edges.get(id);
  };
  for (const d of snapshot.dependencies)
    ensure(d.source, d.target, d.protocol).staticDependencyIds.push(d.id);
  for (const o of observations) {
    if (!o.source.id || !o.target.id) continue;
    const edge = ensure(o.source.id, o.target.id, o.protocol),
      m = o.measurement;
    edge.evidenceIds.push(o.evidenceId);
    if (m.kind === "requests") {
      edge.requestCount = (edge.requestCount ?? 0) + m.count;
      insist(Number.isFinite(edge.requestCount), "request total overflow");
      edge.errorCount = (edge.errorCount ?? 0) + (m.errors ?? 0);
      if (m.errors === null) edge.unknownStatusCount += m.count;
      edge.observed ||= m.count > 0;
    } else {
      // Same span exported through multiple sources must not inflate sample count.
      const ref = evidenceById.get(o.evidenceId).reference;
      const id = JSON.stringify([
        ref.correlationScope,
        ref.traceId,
        ref.serverSpanId,
      ]);
      if (!sampleIds.has(id)) {
        edge.traceSamples.push({ id, durationMs: m.durationMs });
        sampleIds.add(id);
      }
      edge.observed = true;
    }
  }
  const usable = bundle.sources.some((s) => s.coverage !== "unavailable");
  const rows = [...edges.values()]
    .map((e) => ({
      ...e,
      status: e.observed
        ? e.staticDependencyIds.length
          ? "supported"
          : "observed-only"
        : usable
          ? "not-observed"
          : "insufficient-evidence",
      rps: e.requestCount === null ? null : e.requestCount / seconds,
      errorRate:
        e.requestCount > 0 && e.unknownStatusCount === 0
          ? e.errorCount / e.requestCount
          : null,
    }))
    .sort((a, b) =>
      key(a.source, a.target, a.protocol).localeCompare(
        key(b.source, b.target, b.protocol),
      ),
    );
  const report = {
    schemaVersion: "archi/traffic-report-v1alpha1",
    environment: bundle.environment,
    simulation: bundle.simulation,
    window: bundle.window,
    staticContentHash: snapshot.contentHash,
    resolutionVersion: "traffic-reconciliation/2",
    inputHash,
    releaseCorrespondence: "unverified",
    identityRule: "cluster-namespace-deployment-name/1",
    granularity: "workload-pair-protocol",
    sources: bundle.sources.map(({ payload, ...s }) => ({
      ...s,
      payloadHash: hash(payload),
    })),
    edges: rows,
    unresolved: observations.filter((o) => !o.source.id || !o.target.id),
    evidence,
    diagnostics,
  };
  return { ...report, contentHash: hash(report) };
}
