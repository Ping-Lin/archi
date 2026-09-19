#!/usr/bin/env node
import { importTraffic } from "../src/traffic/import.mjs";
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
  const report = await importTraffic({
    analysis: opts["--analysis"],
    bundle: opts["--bundle"],
    out: opts["--out"],
  });
  console.log(
    `${report.environment}: ${report.edges.filter((e) => e.observed).length} observed relationships; ${report.unresolved.length} unresolved observations; ${report.contentHash}`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
