import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { runtimeFixture, CAPTURE_AT } from "../examples/runtime/fixture.mjs";
import { seal } from "../src/runtime/contract.mjs";
import { reconcileRuntime } from "../src/runtime/reconcile.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.ARCHI_BROWSER_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  // Browser-only protocol specimens: never start a real collector or use credentials.
  const original = JSON.parse(await readFile("artifacts/analysis/analysis.json", "utf8"));
  let stored = { ...original, simulation: false }; delete stored.runtime;
  const snapshot = stored.snapshots.find((s) => s.environment === "qa");
  const fixture = runtimeFixture(); fixture.simulation = false;
  for (const c of fixture.collections) if (c.status === "failed") {
    c.status = "complete"; c.reason = null; c.resourceVersion = "100";
  }
  const report = reconcileRuntime(snapshot, seal(fixture), { assessedAt: CAPTURE_AT });
  const updated = { ...stored, runtime: { qa: seal({ schemaVersion: "archi/runtime-overlay-v1alpha1",
    environment: "qa", simulation: false, staticContentHash: snapshot.contentHash, reports: [report] }) } };
  const targets = [{ id: "qa", environment: "qa", cluster: "commerce", namespaces: ["sales-qa"], enabled: true, reason: null }];
  let posts = 0, fail = false, release, started;
  let began = new Promise((r) => { started = r; });
  await page.route("**/analysis.json", (r) => r.fulfill({ json: stored }));
  await page.route("**/api/runtime/targets", (r) => r.fulfill({ json: { configured: true, targets, token: "test-only" } }));
  await page.route("**/api/runtime/refresh", async (r) => {
    posts++; assert.equal(r.request().method(), "POST");
    assert.deepEqual(r.request().postDataJSON(), { targetId: "qa", staticContentHash: snapshot.contentHash });
    const wait = new Promise((resolve) => { release = resolve; }); started(); await wait;
    if (fail) await r.fulfill({ status: 502, json: { message: "Capture incomplete. Previous snapshot retained." } });
    else { stored = updated; await r.fulfill({ json: { analysis: updated, environment: "qa", cluster: "commerce", capturedAt: report.finishedAt } }); }
  });
  await page.goto((process.env.ARCHI_URL ?? "http://127.0.0.1:4173") + "/?view=analysis");
  await page.getByRole("button", { name: "Open runtime inventory", exact: true }).click();
  const refresh = page.getByRole("button", { name: "Refresh runtime", exact: true });
  await page.getByLabel("Runtime refresh target").waitFor();
  assert.match(await page.locator(".runtime-panel").innerText(), /No runtime capture/);
  await page.clock.install(); await page.clock.fastForward(31000);
  await page.getByLabel("Analysis environment").selectOption("production");
  await page.getByLabel("Analysis environment").selectOption("qa");
  assert.equal(posts, 0, "navigation and timers must not collect");
  await refresh.click(); await began;
  assert.equal(await page.getByRole("button", { name: "Refreshing…", exact: true }).isDisabled(), true);
  await page.getByLabel("Analysis environment").selectOption("production");
  release(); await page.getByText(/Updated qa \/ commerce/).waitFor();
  assert.match(await page.locator(".runtime-panel").innerText(), /No runtime capture/);
  await page.getByLabel("Analysis environment").selectOption("qa");
  await page.getByRole("button", { name: "orders", exact: true }).click();
  await page.getByRole("heading", { name: "orders", exact: true }).waitFor();
  began = new Promise((r) => { started = r; });
  await refresh.click(); await began; release();
  await page.getByText(/Updated qa \/ commerce/).waitFor();
  assert.equal(await page.getByRole("heading", { name: "orders", exact: true }).count(), 1, "selection survives refresh");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export analysis" }).click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.equal(exported.runtime.reports[0].contentHash, report.contentHash);
  fail = true; began = new Promise((r) => { started = r; });
  await refresh.click(); await began; release();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /Previous snapshot retained/);
  assert.equal(await page.getByRole("heading", { name: "orders", exact: true }).count(), 1);
  await page.screenshot({ path: "artifacts/runtime-refresh-failure.png", fullPage: true });
  await page.getByRole("button", { name: "Reload setup", exact: true }).click();
  await page.getByLabel("Runtime refresh target").waitFor();
  await page.getByRole("button", { name: "Reload stored analysis", exact: true }).click();
  await page.getByText(/Reloaded stored analysis only/).waitFor();
  assert.equal(posts, 3);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "artifacts/runtime-refresh-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Runtime refresh browser passed: explicit-only requests, empty state, success/export, failure retention, selection, environment switching and recovery");
} finally { await browser.close(); }
