#!/usr/bin/env node
import { parseArgs } from "node:util";
import { importRuntime } from "../src/runtime/import.mjs";
try {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["analysis", "capture", "out", "at", "ttl"].map((k) => [
        k,
        { type: "string" },
      ]),
    ),
  });
  if (![values.analysis, values.capture, values.out, values.at].every(Boolean))
    throw Error(
      "Usage: npm run runtime -- --analysis FILE --capture FILE --out FILE --at UTC_TIMESTAMP [--ttl 300]",
    );
  const report = await importRuntime({
    analysis: values.analysis,
    capture: values.capture,
    out: values.out,
    assessedAt: values.at,
    ttlSeconds: values.ttl === undefined ? 300 : Number(values.ttl),
  });
  console.log(
    `${report.environment} / ${report.cluster}: ${report.findings.length} workload findings; ${report.contentHash}`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
