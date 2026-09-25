import { readJson, updateAnalysis } from "../observations/file.mjs";
import { insist } from "../traffic/validation.mjs";
import { seal } from "./contract.mjs";
import { reconcileRuntime } from "./reconcile.mjs";

export async function importRuntime({
  analysis,
  capture,
  out,
  assessedAt,
  ttlSeconds = 300,
}) {
  return updateAnalysis({
    analysis,
    out,
    transform: async (data) => {
      const input = (await readJson(capture)).value;
      insist(
        data.simulation === input?.simulation,
        "Do not mix synthetic and real captures",
      );
      const snapshot = data.snapshots.find(
        (s) => s.environment === input.environment,
      );
      insist(snapshot, "runtime environment is absent from analysis");
      const report = reconcileRuntime(snapshot, input, {
        assessedAt,
        ttlSeconds,
      });
      const existing = data.runtime?.[input.environment]?.reports ?? [];
      const reports = [
        ...existing.filter((r) => r.cluster !== input.cluster),
        report,
      ].sort((a, b) => a.cluster.localeCompare(b.cluster));
      data.runtime = {
        ...data.runtime,
        [input.environment]: seal({
          schemaVersion: "archi/runtime-overlay-v1alpha1",
          environment: input.environment,
          simulation: data.simulation,
          staticContentHash: snapshot.contentHash,
          reports,
        }),
      };
      return report;
    },
  });
}
