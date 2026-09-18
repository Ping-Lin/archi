#!/usr/bin/env node
import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { analyzeTraffic } from "../src/traffic/model.mjs";
const args = process.argv.slice(2),
  opts = {};
try {
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--analysis", "--bundle", "--out"].includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      opts[args[i]]
    )
      throw Error(
        "Usage: npm run traffic -- --analysis FILE --bundle FILE --out FILE",
      );
    opts[args[i]] = args[i + 1];
  }
  if (!opts["--analysis"] || !opts["--bundle"] || !opts["--out"])
    throw Error("--analysis, --bundle and --out are required");
  const analysis = JSON.parse(await readFile(opts["--analysis"], "utf8")),
    bundle = JSON.parse(await readFile(opts["--bundle"], "utf8"));
  const snapshot = analysis.snapshots.find(
    (s) => s.environment === bundle.environment,
  );
  if (!snapshot) throw Error("Traffic environment is absent from analysis");
  if (analysis.simulation !== bundle.simulation)
    throw Error("Do not mix synthetic and real captures");
  const report = analyzeTraffic(bundle, snapshot);
  analysis.traffic = { ...analysis.traffic, [bundle.environment]: report };
  const output = path.resolve(opts["--out"]),
    temp = `${output}.${process.pid}.tmp`;
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await writeFile(temp, JSON.stringify(analysis, null, 2) + "\n");
    await rename(temp, output);
  } finally {
    await rm(temp, { force: true });
  }
  console.log(
    `${report.environment}: ${report.edges.filter((e) => e.observed).length} observed relationships; ${report.unresolved.length} unresolved observations; ${report.contentHash}`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
