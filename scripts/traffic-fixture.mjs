import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { trafficFixture } from "../examples/traffic/fixture.mjs";
const output = process.argv[2] ?? "artifacts/traffic/bundle.json";
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(trafficFixture(), null, 2) + "\n", {
  flag: "wx",
});
console.log(`Synthetic traffic bundle: ${output}`);
