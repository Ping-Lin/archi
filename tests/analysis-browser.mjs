import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { chromium } = require("playwright");
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARCHI_BROWSER_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({
      viewport: { width: 1512, height: 1100 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    (process.env.ARCHI_URL ?? "http://127.0.0.1:4173") + "/?view=analysis",
  );
  await page.getByRole("heading", { name: "Follow the evidence." }).waitFor();
  assert.equal(await page.locator(".candidate-card").count(), 4);
  await page.getByRole("heading", { name: "clientA", exact: true }).waitFor();
  await page.getByText("Rendered target resource", { exact: true }).waitFor();
  await page.screenshot({
    path: "artifacts/analysis-evidence.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /clientC/ }).click();
  await page
    .getByText("clients.c.enabled=false; requires true", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: /legacyClient/ }).click();
  await page
    .getByText(
      "No supported explicit @Bean registration; candidate is not proven disabled",
      { exact: true },
    )
    .waitFor();
  await page.getByLabel("Analysis environment").selectOption("prod");
  await page.getByRole("button", { name: /clientA/ }).click();
  await page
    .getByText("No deployment or runtime input", { exact: true })
    .waitFor();
  assert.match(
    await page.locator(".dimension-grid").innerText(),
    /unavailable/,
  );
  await page.getByRole("tab", { name: "Compare environments" }).click();
  assert.equal(await page.locator(".analysis-table tbody tr").count(), 4);
  assert.match(
    await page
      .locator(".analysis-table tbody tr")
      .filter({ hasText: "clientB" })
      .innerText(),
    /enabled[\s\S]*disabled/i,
  );
  await page.screenshot({
    path: "artifacts/analysis-comparison.png",
    fullPage: true,
  });
  await page.getByLabel("Analysis environment").selectOption("dev");
  await page.getByRole("tab", { name: "Resource inventory" }).click();
  await page.getByText("unmanaged-worker", { exact: true }).waitFor();
  const checkout = page
    .locator(".analysis-table tbody tr")
    .filter({ hasText: "checkout-dev-checkout" });
  assert.match(
    await checkout.innerText(),
    /matching supported fields[\s\S]*progressing/i,
  );
  await page.screenshot({
    path: "artifacts/analysis-resources.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export analysis/ }).click();
  assert.equal((await download).suggestedFilename(), "archi-analysis-dev.json");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Connections & evidence" }).click();
  await page.screenshot({
    path: "artifacts/analysis-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile page overflows",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Analysis browser: evidence, exclusion, prod isolation, comparison, resources, export and mobile passed",
  );
} finally {
  await browser.close();
}
