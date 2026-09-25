import { assertSnapshot, hash, VERSION } from "../analysis/contract.mjs";

export const LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  depth: 64,
  nodes: 500000,
  records: 50000,
  sources: 32,
});
export function insist(condition, message) {
  if (!condition) throw Error(`Traffic: ${message}`);
}
export function boundedJson(value) {
  const stack = [[value, 0]];
  let count = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    insist(
      ++count <= LIMITS.nodes && depth <= LIMITS.depth,
      "JSON complexity limit exceeded",
    );
    if (typeof v === "number")
      insist(Number.isFinite(v), "non-finite JSON number");
    else if (v !== null && typeof v === "object") {
      insist(
        Array.isArray(v) ||
          Object.getPrototypeOf(v) === Object.prototype ||
          Object.getPrototypeOf(v) === null,
        "plain JSON objects required",
      );
      for (const item of Object.values(v)) stack.push([item, depth + 1]);
    } else
      insist(
        v === null || ["string", "boolean"].includes(typeof v),
        "non-JSON value",
      );
  }
}
export function verifyHash(value, label) {
  insist(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} object required`,
  );
  const { contentHash, ...body } = value;
  insist(
    typeof contentHash === "string" &&
      /^[a-f0-9]{64}$/.test(contentHash) &&
      hash(body) === contentHash,
    `${label} content hash mismatch`,
  );
}
export function validateSnapshot(snapshot) {
  boundedJson(snapshot);
  verifyHash(snapshot, "snapshot");
  insist(snapshot.schemaVersion === VERSION, "unsupported snapshot version");
  insist(
    typeof snapshot.environment === "string" && snapshot.environment.length > 0,
    "snapshot environment required",
  );
  for (const field of [
    "instances",
    "dependencies",
    "evidence",
    "facts",
    "resolutions",
    "candidates",
  ])
    insist(Array.isArray(snapshot[field]), `snapshot ${field} array required`);
  const ids = new Set();
  for (const field of ["evidence", "facts", "resolutions", "candidates"])
    for (const record of snapshot[field])
      insist(
        record &&
          typeof record.id === "string" &&
          record.id.length > 0 &&
          ((field === "candidates" && record.environment === undefined) ||
            record.environment === snapshot.environment),
        `invalid ${field} record`,
      );
  for (const i of snapshot.instances) {
    insist(
      i &&
        [i.id, i.workload, i.scope?.cluster, i.scope?.namespace].every(
          (v) => typeof v === "string" && v.length > 0,
        ),
      "invalid snapshot instance",
    );
    insist(!ids.has(i.id), "duplicate snapshot instance");
    ids.add(i.id);
  }
  for (const d of snapshot.dependencies)
    insist(
      d &&
        [d.id, d.source, d.target, d.protocol].every(
          (v) => typeof v === "string" && v.length > 0,
        ) &&
        ids.has(d.source),
      "invalid snapshot dependency",
    );
  assertSnapshot(snapshot);
}
export function validateAnalysis(analysis) {
  boundedJson(analysis);
  insist(
    analysis?.schemaVersion === VERSION &&
      typeof analysis.simulation === "boolean" &&
      Array.isArray(analysis.snapshots) &&
      analysis.snapshots.length > 0,
    "invalid analysis envelope",
  );
  const environments = new Map();
  for (const s of analysis.snapshots) {
    validateSnapshot(s);
    insist(!environments.has(s.environment), "duplicate snapshot environment");
    environments.set(s.environment, s);
  }
  if (analysis.runtime !== undefined) {
    insist(
      analysis.runtime &&
        typeof analysis.runtime === "object" &&
        !Array.isArray(analysis.runtime),
      "invalid runtime map",
    );
    for (const [env, report] of Object.entries(analysis.runtime)) {
      verifyHash(report, "runtime report");
      insist(
        report.schemaVersion === "archi/runtime-overlay-v1alpha1" &&
          report.environment === env &&
          report.simulation === analysis.simulation &&
          report.staticContentHash === environments.get(env)?.contentHash &&
          Array.isArray(report.reports) &&
          report.reports.length > 0,
        "runtime report snapshot correspondence mismatch",
      );
      const clusters = new Set();
      for (const child of report.reports) {
        verifyHash(child, "cluster runtime report");
        insist(
          child.schemaVersion === "archi/runtime-report-v1alpha1" &&
            child.environment === env &&
            child.staticContentHash === report.staticContentHash &&
            child.simulation === report.simulation &&
            typeof child.cluster === "string" &&
            !clusters.has(child.cluster) &&
            Array.isArray(child.findings) &&
            Array.isArray(child.evidence),
          "invalid cluster runtime report",
        );
        clusters.add(child.cluster);
      }
    }
  }
  if (analysis.traffic !== undefined) {
    insist(
      analysis.traffic !== null &&
        typeof analysis.traffic === "object" &&
        !Array.isArray(analysis.traffic),
      "invalid traffic map",
    );
    for (const [env, report] of Object.entries(analysis.traffic)) {
      verifyHash(report, "traffic report");
      insist(
        report.environment === env &&
          report.simulation === analysis.simulation &&
          report.staticContentHash === environments.get(env)?.contentHash,
        "traffic report snapshot correspondence mismatch",
      );
    }
  }
}
export function nanos(value) {
  insist(
    typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value),
    "span timestamp must be a decimal uint64 string",
  );
  const n = BigInt(value);
  insist(n <= 18446744073709551615n, "span timestamp exceeds uint64");
  return n;
}
export function timestamp(value) {
  insist(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value),
    "window timestamps must use UTC ISO milliseconds",
  );
  const date = new Date(value),
    time = date.getTime();
  insist(
    Number.isFinite(time) &&
      date.toISOString() ===
        value.replace(
          /(?:\.(\d{1,3}))?Z$/,
          (_, fraction) => "." + (fraction ?? "").padEnd(3, "0") + "Z",
        ),
    "invalid calendar timestamp",
  );
  return time;
}
