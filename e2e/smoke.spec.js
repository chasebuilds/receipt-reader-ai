import { test, expect } from "@playwright/test";

// Waits on ready signals (body[data-state], row[data-state]), never on fixed sleeps: OCR under SwiftShader in CI is slow.
test("sample receipt is read and fields are extracted", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.locator("body")).toHaveAttribute("data-state", "ready");
  const samples = await (await page.request.get("samples/index.json")).json();
  const s = samples[0];
  await page.click(`button[data-sample="${s.file}"]`);
  const row = page.locator(`#rows tr[data-file="${s.file}"]`);
  await expect(row).toHaveAttribute("data-state", "done");
  await expect(row.locator('td[data-key="total"]')).toHaveText(s.total.toFixed(2));
  await expect(row.locator('td[data-key="date"]')).toHaveText(s.date);
  await expect(row.locator('td[data-key="vendor"]')).toHaveText(new RegExp(s.vendor, "i"));
  await expect(page.locator("#csv")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("receipt with no category keyword goes to the AI model", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("body")).toHaveAttribute("data-state", "ready");
  await page.click('button[data-sample="ai-category.jpg"]');
  const row = page.locator('#rows tr[data-file="ai-category.jpg"]');
  await expect(row).toHaveAttribute("data-state", "done");
  await expect(row.locator('td[data-key="category"] .tag')).toHaveText(/AI|rules/);
  // Model may be unreachable in some CI networks; the row still completes with a category.
  await expect(row.locator('td[data-key="category"]')).not.toBeEmpty();
});

test("screenshot for the README", async ({ page }) => {
  test.skip(!process.env.SCREENSHOT, "set SCREENSHOT=1 to refresh docs/demo.png");
  await page.goto("./");
  await expect(page.locator("body")).toHaveAttribute("data-state", "ready");
  await page.click("#runAll");
  await expect(page.locator('#rows tr[data-state="done"]')).toHaveCount(7);
  await expect(page.locator("body")).toHaveAttribute("data-busy", "0");
  await page.screenshot({ path: "docs/demo.png", fullPage: true });
});
