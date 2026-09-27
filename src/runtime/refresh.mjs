import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readJson, updateAnalysis } from "../observations/file.mjs";
import { createJson } from "../observations/create.mjs";
import { validateAnalysis } from "../traffic/validation.mjs";
import { collectRuntime, kubectlReader } from "./collect.mjs";
import { seal, validateCapture, KINDS } from "./contract.mjs";
import { reconcileRuntime } from "./reconcile.mjs";
import { RefreshError } from "./http.mjs";

const fail = (status, message) => { throw new RefreshError(status, message); };
export function validateRefreshConfig(config) {
  const exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).sort().join("|") === keys.sort().join("|");
  if (!exact(config, ["schemaVersion", "targets"]) || config.schemaVersion !== "archi/runtime-refresh-v1alpha1" ||
    !Array.isArray(config.targets) || config.targets.length > 32) throw Error("Invalid runtime refresh configuration");
  const ids = new Set(), scopes = new Set();
  for (const t of config.targets) {
    if (!exact(t, ["id", "environment", "cluster", "context", "kubeconfig", "namespaces"]) ||
      ![t.id, t.environment, t.cluster].every((v) => typeof v === "string" && /^[a-z][a-z0-9.-]{0,63}$/.test(v)) ||
      typeof t.context !== "string" || !t.context.length || t.context.length > 1024 ||
      typeof t.kubeconfig !== "string" || !path.isAbsolute(t.kubeconfig) ||
      !Array.isArray(t.namespaces) || !t.namespaces.length || t.namespaces.length > 16 ||
      !t.namespaces.every((n) => typeof n === "string" && n.length <= 63 && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(n)) ||
      new Set(t.namespaces).size !== t.namespaces.length || ids.has(t.id) ||
      scopes.has(JSON.stringify([t.environment, t.cluster]))) throw Error("Invalid or duplicate runtime refresh target");
    ids.add(t.id); scopes.add(JSON.stringify([t.environment, t.cluster]));
  }
  return structuredClone(config);
}

export function createRuntimeRefresh(root, config = { schemaVersion: "archi/runtime-refresh-v1alpha1", targets: [] },
  { collect = collectRuntime, reader = kubectlReader, clock = () => Date.now() } = {}) {
  const { targets } = validateRefreshConfig(config);
  const analysisFile = path.resolve(root, "artifacts/analysis/analysis.json");
  // One refresh at a time per local server, including publication to the shared file.
  let busy = false;
  const readAnalysis = async () => {
    try { const { value } = await readJson(analysisFile); validateAnalysis(value); return value; }
    catch { fail(409, "Analysis is unavailable or invalid. Run analysis before refreshing runtime."); }
  };
  const baseline = (analysis, t) => {
    if (analysis.simulation) fail(409, "Synthetic analysis cannot query a real cluster. Use a reviewed real-input baseline.");
    const s = analysis.snapshots.find((s) => s.environment === t.environment);
    const instances = s?.instances.filter((i) => i.scope.cluster === t.cluster) ?? [];
    if (!instances.length || instances.some((i) => !t.namespaces.includes(i.scope.namespace)))
      fail(409, "Target must cover every bound namespace in the selected environment and cluster.");
    return s;
  };
  return {
    async describe() {
      if (!targets.length) return { configured: false, targets: [] };
      let analysis;
      try { analysis = await readAnalysis(); } catch { /* Explain per target without exposing paths. */ }
      return { configured: true, targets: targets.map((t) => {
        let reason = null;
        try { if (!analysis) fail(409, "Analysis unavailable. Run analysis first."); baseline(analysis, t); }
        catch (e) { reason = e.message; }
        return { id: t.id, environment: t.environment, cluster: t.cluster, namespaces: t.namespaces,
          enabled: !reason, reason };
      }) };
    },
    async refresh(input, { signal } = {}) {
      if (!input || Object.keys(input).sort().join("|") !== "staticContentHash|targetId" ||
        typeof input.targetId !== "string" || typeof input.staticContentHash !== "string" || !/^[a-f0-9]{64}$/.test(input.staticContentHash))
        fail(400, "Supply targetId and the displayed staticContentHash only.");
      const t = targets.find((t) => t.id === input.targetId);
      if (!t) fail(404, "Runtime target is not configured.");
      if (busy) fail(409, "Another runtime refresh is in progress. Wait for it to finish before retrying.");
      busy = true;
      try {
        const initial = await readAnalysis();
        if (baseline(initial, t).contentHash !== input.staticContentHash)
          fail(409, "The source baseline changed. Reload analysis before retrying.");
        signal?.throwIfAborted();
        const capture = validateCapture(await collect(t, { read: reader({ ...t, signal }), clock, signal }));
        signal?.throwIfAborted();
        if (capture.simulation || capture.environment !== t.environment || capture.cluster !== t.cluster ||
          capture.context !== t.context || capture.collections.length !== t.namespaces.length * KINDS.length ||
          capture.collections.some((c) => !t.namespaces.includes(c.namespace)))
          fail(502, "Collector scope did not match the configured target. Previous snapshot retained.");
        const archive = path.resolve(root, "artifacts/runtime-captures");
        await mkdir(archive, { recursive: true, mode: 0o700 });
        await createJson(path.join(archive, `${randomUUID()}.json`), capture);
        if (capture.collections.some((c) => c.status !== "complete"))
          fail(502, "Capture incomplete or access unavailable. Previous snapshot retained; partial capture archived locally.");
        const assessedAt = new Date(clock()).toISOString();
        let updated;
        await updateAnalysis({ analysis: analysisFile, out: analysisFile, transform: async (data) => {
          signal?.throwIfAborted();
          const s = baseline(data, t);
          if (s.contentHash !== input.staticContentHash)
            fail(409, "The source baseline changed during collection. Previous snapshot retained; reload analysis.");
          const report = reconcileRuntime(s, capture, { assessedAt, ttlSeconds: 300 });
          data.runtime = { ...data.runtime, [t.environment]: seal({
            schemaVersion: "archi/runtime-overlay-v1alpha1", environment: t.environment,
            simulation: false, staticContentHash: s.contentHash,
            reports: [...(data.runtime?.[t.environment]?.reports ?? []).filter((r) => r.cluster !== t.cluster), report]
              .sort((a, b) => a.cluster.localeCompare(b.cluster)),
          }) };
          updated = data;
          return report;
        } });
        return { analysis: updated, environment: t.environment, cluster: t.cluster,
          capturedAt: capture.finishedAt, captureHash: capture.contentHash };
      } catch (e) {
        if (e instanceof RefreshError) throw e;
        if (signal?.aborted) fail(408, "Refresh cancelled or timed out. Reload stored analysis to confirm the last committed snapshot.");
        fail(500, "Refresh could not be completed. Reload stored analysis to confirm the last committed snapshot; no automatic retry.");
      } finally { busy = false; }
    },
  };
}
