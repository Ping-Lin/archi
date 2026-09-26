const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
export async function verifyDisplayBundle(bundle) {
  // Local file import checks integrity, not authenticity or deterministic replay.
  let nodes = 0;
  const walk = (v, depth = 0) => {
    if (++nodes > 500000 || depth > 64) throw Error("Bundle complexity limit exceeded");
    if (v && typeof v === "object") for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(bundle);
  const verify = async (value) => {
    const { contentHash, ...body } = value;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(body))));
    const actual = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
    if (actual !== contentHash) throw Error("Bundle integrity check failed");
  };
  if (bundle?.schemaVersion !== "archi/runtime-acceptance-v1alpha1" ||
    !["scenarios", "captures"].includes(bundle.mode) || typeof bundle.simulation !== "boolean" ||
    typeof bundle.engine?.ruleVersion !== "string" || typeof bundle.engine?.sourceHash !== "string" ||
    (bundle.mode === "scenarios" && !bundle.simulation) ||
    !Array.isArray(bundle.cases) || !bundle.cases.length || bundle.cases.length > 100)
    throw Error("Unsupported acceptance bundle");
  await verify(bundle);
  const ids = new Set();
  for (const c of bundle.cases) {
    if (typeof c.id !== "string" || ids.has(c.id) || typeof c.title !== "string" ||
      !Array.isArray(c.report?.findings) || !Array.isArray(c.report?.evidence) ||
      !Number.isFinite(Date.parse(c.report.finishedAt)) || !Number.isFinite(Date.parse(c.report.startedAt)) ||
      (c.expected !== null && (!c.expected || typeof c.expected !== "object" || Array.isArray(c.expected) ||
        Object.values(c.expected).some((v) => !Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== "string")))) ||
      c.report.environment !== c.snapshot?.environment || c.report.environment !== c.capture?.environment ||
      c.report.cluster !== c.capture.cluster || c.report.simulation !== bundle.simulation ||
      c.capture.simulation !== bundle.simulation || c.report.staticContentHash !== c.snapshot.contentHash ||
      c.report.captureHash !== c.capture.contentHash) throw Error("Invalid acceptance case");
    ids.add(c.id);
    for (const f of c.report.findings) if (!Array.isArray(f.baselineImages) || !Array.isArray(f.workloadImages) ||
      !Array.isArray(f.pods) || !Array.isArray(f.reasonCodes) || !Array.isArray(f.evidenceIds) ||
      !Array.isArray(f.baselineEvidenceIds) || f.pods.some((p) => !Array.isArray(p.containers)))
      throw Error("Invalid runtime finding");
    await verify(c.snapshot); await verify(c.capture); await verify(c.report);
  }
  return bundle;
}
export function expectationRows(c) {
  const findings = new Map(c.report.findings.filter((f) => f.instanceId !== null).map((f) => [f.instanceId, f]));
  return [...new Set([...findings.keys(), ...Object.keys(c.expected ?? {})])].map((id) => {
    const f = findings.get(id), expected = c.expected?.[id] ?? null;
    const actual = f ? [f.specAlignment, f.rollout, f.classification] : null;
    return { id, expected, actual, result: !expected ? "not-provided"
      : JSON.stringify(expected) === JSON.stringify(actual) ? "matched" : "mismatch" };
  });
}
