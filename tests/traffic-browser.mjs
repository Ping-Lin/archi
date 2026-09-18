import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  await page.locator(".analyzed-edge").first().waitFor();
  assert.equal(await page.locator(".analyzed-edge.observed").count(), 2);
  await page
    .getByRole("tab", { name: "Traffic evidence", exact: true })
    .click();
  await page
    .getByRole("button", { name: "portal → orders", exact: true })
    .click();
  const row = page
    .locator(".traffic-table tr")
    .filter({
      has: page.getByRole("button", { name: "portal → orders", exact: true }),
    });
  assert.match(await row.innerText(), /300\s+1\s+5%\s+1/);
  assert.match(
    await page.locator(".traffic-evidence").first().innerText(),
    /25 ms/,
  );
  assert.match(
    await page.locator(".traffic-panel").innerText(),
    /observed-only/i,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export analysis" }).click();
  const exported = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  assert.equal(exported.schemaVersion, "archi/inspection-v1alpha1");
  assert.equal(
    exported.snapshot.contentHash,
    exported.traffic.staticContentHash,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/phase-five-traffic.png",
    fullPage: true,
  });
  await page.getByLabel("Analysis environment").selectOption("production");
  assert.match(
    await page.locator(".traffic-panel").innerText(),
    /No traffic capture/,
  );
  await page.getByLabel("Analysis environment").selectOption("qa");
  assert.equal(
    await page.locator(".traffic-evidence h3").count(),
    0,
    "selection resets across environments",
  );
  await page.getByText("Unresolved identities · 1", { exact: true }).click();
  assert.match(
    await page.locator(".traffic-panel").innerText(),
    /unknown-namespace/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "page fits mobile; table scrolls internally",
  );
  await page.screenshot({
    path: "artifacts/phase-five-traffic-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Traffic browser: overlay, metrics, evidence, environment isolation and mobile passed",
  );
} finally {
  await browser.close();
}
