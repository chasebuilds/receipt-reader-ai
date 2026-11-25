import { test } from "node:test";
import assert from "node:assert/strict";
import { amountsIn, extractDate, extractFields, categoryByRules, finalCategory, toCsv } from "../site/lib/extract.js";

const RECEIPT = `BLUEFIN NOODLE BAR
7139 Center Blvd
Lakemont, ST 41690
Date: Apr 09, 2026 17:44
Receipt #620992
2 x Iced Coffee 10.58
Club Sandwich 12.77
Sub Total 23.35
Tax 7% 1.63
GRAND TOTAL $24.98
VISA ****7416 24.98`;

test("amounts: dollar sign, thousands, OCR-split decimals, ignores percents", () => {
  assert.deepEqual(amountsIn("Total $1,234.56"), [1234.56]);
  assert.deepEqual(amountsIn("Tax 7% 1.63"), [1.63]);
  assert.deepEqual(amountsIn("TOTAL 46. 41"), [46.41]);
  assert.deepEqual(amountsIn("no money here 2026"), []);
});

test("dates in five formats come back as ISO", () => {
  assert.equal(extractDate("03/05/2026"), "2026-03-05");
  assert.equal(extractDate("2026-03-05"), "2026-03-05");
  assert.equal(extractDate("Mar 05, 2026"), "2026-03-05");
  assert.equal(extractDate("05-Mar-2026"), "2026-03-05");
  assert.equal(extractDate("3/5/26 14:02"), "2026-03-05");
  assert.equal(extractDate("nothing"), null);
});

test("fields from a full receipt", () => {
  const f = extractFields(RECEIPT);
  assert.equal(f.vendor, "BLUEFIN NOODLE BAR");
  assert.equal(f.date, "2026-04-09");
  assert.equal(f.subtotal, 23.35);
  assert.equal(f.tax, 1.63);
  assert.equal(f.total, 24.98);
  assert.equal(f.category, "Meals");
  assert.deepEqual(f.notes, []);
});

test("subtotal line is never taken as the total", () => {
  assert.equal(extractFields("Shop\nSub. Total 10.00\nTax 0.50\nTOTAL 10.50").total, 10.5);
});

test("unreadable total is rebuilt from subtotal + tax, and flagged", () => {
  const f = extractFields("Shop\nSubtotal 10.00\nTax 0.70\nGRAND TOTAL 2: 2%");
  assert.equal(f.total, 10.7);
  assert.match(f.notes[0], /computed/);
});

test("missing tax is rebuilt from total - subtotal", () => {
  assert.equal(extractFields("Shop\nSubtotal 12.71\nTAX LST\nTOTAL 13.35").tax, 0.64);
});

test("mismatched arithmetic is reported", () => {
  assert.match(extractFields("Shop\nSubtotal 10.00\nTax 1.00\nTotal 12.00").notes[0], /subtotal \+ tax/);
});

test("category rules", () => {
  assert.equal(categoryByRules("Quickfill Fuel Stop\nUnleaded Regular 40.00").category, "Fuel");
  assert.equal(categoryByRules("Harborview Inn\nRoom Night King").category, "Lodging");
  assert.equal(categoryByRules("Acme\nWidget").category, "Other");
});

test("model is asked only when no keyword matched", async () => {
  let calls = 0;
  const fake = async (_text, labels) => (calls++, { labels: [labels[4]], scores: [0.9] });
  assert.equal((await finalCategory(fake, extractFields(RECEIPT), RECEIPT)).source, "rules");
  const other = "Acme Co\nWidget 5.00\nTotal 5.00";
  const r = await finalCategory(fake, extractFields(other), other);
  assert.deepEqual([r.category, r.source, calls], ["Lodging", "model", 1]);
});

test("csv escapes commas and quotes", () => {
  const csv = toCsv([{ file: "a.jpg", vendor: 'Joe, "The" Shop', total: 5 }]);
  assert.equal(csv.split("\n")[1], 'a.jpg,"Joe, ""The"" Shop",,,,,5');
});
