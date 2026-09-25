// Display freshness advances independently of the immutable report's assessment.
export function displayFreshness(report, finding, now = Date.now()) {
  if (finding.freshness === "unknown" || now < Date.parse(report.finishedAt))
    return "unknown";
  return now - Date.parse(report.startedAt) > report.ttlSeconds * 1000
    ? "stale"
    : finding.freshness;
}
export function runtimeRows(overlay) {
  return (overlay?.reports ?? []).flatMap((report) =>
    report.findings.map((finding) => ({ report, finding })),
  );
}
