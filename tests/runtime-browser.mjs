import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { hash } from "../src/analysis/contract.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.ARCHI_BROWSER_EXECUTABLE || undefined,
});
try {
  const page = await browser.newPage({
      viewport: { width: 1512, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    (process.env.ARCHI_URL ?? "http://127.0.0.1:4173") + "/?view=analysis",
  );
  await page.locator(".runtime-badge").first().waitFor();
  assert.equal(await page.locator(".runtime-badge").count(), 4);
  assert.equal(
    await page.locator(".analyzed-edge.observed").count(),
    2,
    "traffic overlay survives runtime import",
  );
  await page.screenshot({
    path: "artifacts/runtime-graph.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inspect runtime orders", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "orders", exact: true }).waitFor();
  const detail = page.locator(".runtime-detail");
  assert.match(await detail.innerText(), /example.invalid\/orders:synthetic/);
  assert.match(await detail.innerText(), /example.invalid\/orders:previous/);
  assert.match(await detail.innerText(), /example.invalid\/orders:older/);
  assert.match(await detail.innerText(), /Observed Pods contain multiple image versions/);
  const row = (name) =>
    page
      .locator(".runtime-table tr")
      .filter({ has: page.getByRole("button", { name, exact: true }) });
  assert.match(
    await row("orders").innerText(),
    /different[\s\S]*progressing[\s\S]*available/,
  );
  assert.match(await row("inventory").innerText(), /absent/);
  assert.match(await row("orders-shadow").innerText(), /unknown[\s\S]*failed/);
  assert.match(
    await page.locator(".runtime-panel").innerText(),
    /Synthetic specimen/,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export analysis" }).click();
  const output = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  for (const item of [
    output.snapshot,
    output.traffic,
    output.runtime,
    ...output.runtime.reports,
  ]) {
    const { contentHash, ...body } = item;
    assert.equal(hash(body), contentHash);
  }
  assert.equal(output.runtime.staticContentHash, output.snapshot.contentHash);
  await page.screenshot({
    path: "artifacts/runtime-details.png",
    fullPage: true,
  });
  await page.getByLabel("Analysis environment").selectOption("production");
  assert.match(
    await page.locator(".runtime-panel").innerText(),
    /No runtime capture/,
  );
  assert.equal(await page.locator(".runtime-detail").count(), 0);
  await page.getByLabel("Analysis environment").selectOption("qa");
  await page.getByRole("button", { name: "orders", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile contains runtime details",
  );
  await page.screenshot({
    path: "artifacts/runtime-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Runtime browser passed: graph badge, three states, coverage, export hashes, environment isolation and mobile",
  );
} finally {
  await browser.close();
}
