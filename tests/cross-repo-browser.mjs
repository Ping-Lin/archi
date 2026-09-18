import { createRequire } from "node:module";
import assert from "node:assert/strict";
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
  assert.equal(await page.locator(".analyzed-edge").count(), 5);
  const overlap=await page.evaluate(()=>{
    const rects=selector=>[...document.querySelectorAll(selector)].map(n=>n.getBoundingClientRect());
    return rects('.analyzed-edge rect').some(a=>rects('.analyzed-node rect').some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));
  });
  assert.equal(overlap,false,'Edge labels must not cover nodes');
  await page
    .getByRole("button", {
      name: "portal to orders via downstream",
      exact: true,
    })
    .locator('rect')
    .click();
  assert.match(
    await page.locator(".binding-detail").innerText(),
    /experience \/ portal/,
  );
  assert.match(
    await page.locator(".binding-detail").innerText(),
    /Target sales \/ orders/,
  );
  assert.match(
    await page.locator(".binding-detail").innerText(),
    /[a-f0-9]{40}/,
  );
  await page.locator(".revision-panel summary").click();
  assert.equal(await page.locator(".revision-panel code").count(), 4);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/phase-four-cross-project.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "orders-shadow to inventory via downstream",
      exact: true,
    })
    .locator('rect')
    .click();
  assert.match(
    await page.locator(".binding-detail").innerText(),
    /sales \/ orders/,
  );
  assert.match(await page.locator(".binding-detail").innerText(), /sandbox-qa/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/phase-four-instance-evidence.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inspect excluded missing", exact: true })
    .click();
  assert.match(await page.locator(".dimension-grid").innerText(), /unresolved/);
  await page.getByRole("tab", { name: "Compare environments" }).click();
  assert.equal(await page.locator(".analysis-table tbody tr").count(), 7);
  await page.screenshot({
    path: "artifacts/phase-four-environments.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Service graph" }).click();
  await page.getByLabel("Analysis environment").selectOption("production");
  assert.equal(await page.locator(".analyzed-edge").count(), 4);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log("Cross-repository browser passed");
} finally {
  await browser.close();
}
