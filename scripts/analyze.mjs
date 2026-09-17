#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, writeAnalysis, checkOracle } from "../src/analysis/run.mjs";
const args = process.argv.slice(2);
const allowed = [
  "--root",
  "--config",
  "--out",
  "--revision",
  "--at",
  "--oracle",
];
function option(flag, fallback) {
  const i = args.indexOf(flag);
  return i < 0 ? fallback : args[i + 1];
}
try {
  for (let i = 0; i < args.length; i += 2)
    if (
      !allowed.includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error(
        "Usage: npm run analyze -- [--root PATH] [--config PATH] [--out PATH] [--revision REF] [--at ISO] [--oracle PATH]",
      );
  const root = path.resolve(
    option(
      "--root",
      path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
    ),
  );
  const result = await analyze(
    root,
    option("--config", "examples/analysis/archi.config.json"),
    {
      revision: option("--revision", null),
      asOf: option("--at", new Date().toISOString()),
    },
  );
  if (option("--oracle"))
    await checkOracle(result, path.resolve(root, option("--oracle")));
  const out = path.resolve(root, option("--out", "artifacts/analysis"));
  await writeAnalysis(result, out);
  console.log(`Analysis saved: ${out}/analysis.json`);
  for (const s of result.snapshots)
    console.log(
      `${s.environment}: ${s.dependencies.length} dependencies, ${s.candidates.length} candidates, ${s.diagnostics.length} diagnostics · ${s.contentHash.slice(0, 12)}`,
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
