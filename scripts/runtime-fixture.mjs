#!/usr/bin/env node
import { runtimeFixture } from "../examples/runtime/fixture.mjs";
import { createJson } from "../src/observations/create.mjs";
try {
  if (process.argv.length !== 3)
    throw Error(
      "Usage: node scripts/runtime-fixture.mjs NEW_FILE (parent directory must exist)",
    );
  await createJson(process.argv[2], runtimeFixture());
  console.log("Synthetic runtime fixture created");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
