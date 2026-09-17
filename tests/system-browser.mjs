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
  assert.equal(await page.locator(".analyzed-edge").count(), 4);
  const labels = await page
    .locator(".analyzed-edge rect")
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i],
        b = labels[j];
      assert.ok(
        a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top,
        "Connection labels must not overlap",
      );
    }
  const choose = (source, target) =>
    page
      .getByRole("button", {
        name: `${source} to ${target} via downstream`,
        exact: true,
      })
      .click();
  await choose("orders", "inventory");
  assert.match(await page.locator(".dimension-grid").innerText(), /observed/);
  assert.match(await page.locator(".connection-strip").innerText(), /orders/);
  await choose("storefront", "orders");
  assert.match(
    await page.locator(".dimension-grid").innerText(),
    /unavailable/,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/phase-three-qa-system.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Compare environments" }).click();
  const rows = page.locator(".analysis-table tbody tr");
  assert.equal(await rows.count(), 5);
  for (const source of ["storefront", "orders", "inventory"]) {
    assert.equal(
      await rows.filter({ hasText: `${source} / downstream` }).count(),
      1,
    );
  }
  await page.screenshot({
    path: "artifacts/phase-three-caller-comparison.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Service graph" }).click();
  await page.getByLabel("Analysis environment").selectOption("production");
  assert.equal(await page.locator(".analyzed-edge").count(), 3);
  await choose("orders", "inventory");
  assert.match(
    await page.locator(".dimension-grid").innerText(),
    /unavailable/,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/phase-three-production-system.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inspect excluded dynamic", exact: true })
    .click();
  assert.match(await page.locator(".reason-list").innerText(), /dynamic/);
  await page.getByLabel("Search analyzed relationships").fill("warehouse");
  assert.equal(await page.locator(".analyzed-edge").count(), 1);
  await page.getByLabel("Search analyzed relationships").fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "artifacts/phase-three-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log("Multi-caller browser passed");
} finally {
  await browser.close();
}
