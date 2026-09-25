import { readJson, updateAnalysis } from "../observations/file.mjs";
import { analyzeTraffic } from "./model.mjs";
import { insist } from "./validation.mjs";
export { readJson } from "../observations/file.mjs";

export async function importTraffic({ analysis, bundle, out }) {
  return updateAnalysis({
    analysis,
    out,
    transform: async (data) => {
      const capture = (await readJson(bundle)).value;
      insist(
        data.simulation === capture?.simulation,
        "Do not mix synthetic and real captures",
      );
      const snapshot = data.snapshots.find(
        (s) => s.environment === capture.environment,
      );
      insist(snapshot, "Traffic environment is absent from analysis");
      const report = analyzeTraffic(capture, snapshot);
      data.traffic = { ...data.traffic, [capture.environment]: report };
      return report;
    },
  });
}
