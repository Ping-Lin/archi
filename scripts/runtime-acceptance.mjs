#!/usr/bin/env node
import { parseArgs } from "node:util";
import { scenarioBundle, captureBundle, verifyBundle } from "../src/runtime/acceptance.mjs";
import { readJson } from "../src/observations/file.mjs";
import { createJson } from "../src/observations/create.mjs";
try {
  const { values: v } = parseArgs({ options: {
    scenarios: { type: "boolean" }, verify: { type: "string" }, analysis: { type: "string" },
    capture: { type: "string", multiple: true }, at: { type: "string" },
    ttl: { type: "string" }, out: { type: "string" },
  } });
  let bundle;
  if (v.verify) {
    if (Object.keys(v).length !== 1) throw Error("--verify cannot be combined with creation options");
    bundle = (await readJson(v.verify)).value;
  } else {
    if (!v.out) throw Error("A new --out FILE is required; parent directory must exist");
    if (v.scenarios) {
      if (Object.keys(v).some((k) => !["scenarios", "out"].includes(k))) throw Error("--scenarios only accepts --out");
      bundle = await scenarioBundle();
    } else {
      if (!v.analysis || !v.capture?.length || !v.at) throw Error("Use --scenarios --out FILE, --verify FILE, or --analysis FILE --capture FILE [--capture FILE] --at UTC --out FILE [--ttl 300]");
      bundle = await captureBundle((await readJson(v.analysis)).value,
        await Promise.all(v.capture.map(async (f) => (await readJson(f)).value)),
        { assessedAt: v.at, ttlSeconds: v.ttl === undefined ? 300 : Number(v.ttl) });
    }
  }
  const results = await verifyBundle(bundle);
  if (!v.verify) await createJson(v.out, bundle);
  for (const r of results) console.log(`${r.id}: replay ${r.replay}; independent expectation ${r.expectation}`);
  console.log(`Bundle SHA-256: ${bundle.contentHash}`);
  if (results.some((r) => r.expectation === "mismatch")) process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
