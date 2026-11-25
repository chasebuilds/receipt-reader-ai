// Benchmark: OCR every synthetic receipt with tesseract.js, extract fields, score against truth.json.
//   node bench/run.mjs            # OCR (cached in bench/.ocr-cache.json) + rules + zero-shot model
//   node bench/run.mjs --no-model # skip the model
// Writes bench/results.json and the table between the bench markers in README.md.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractFields, categoryByModel, finalCategory } from "../site/lib/extract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ID = "Xenova/mobilebert-uncased-mnli";
const SETS = ["dev", "holdout"];
const useModel = !process.argv.includes("--no-model");
const cacheFile = path.join(ROOT, "bench/.ocr-cache.json");
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
const truths = Object.fromEntries(SETS.map((k) => [k, JSON.parse(readFileSync(path.join(ROOT, "data", k, "truth.json"), "utf8"))]));

const missing = SETS.flatMap((k) => truths[k].map((t) => `${k}/${t.file}`)).filter((key) => !cache[key]);
if (missing.length) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  for (const key of missing) {
    const [set, file] = key.split("/");
    cache[key] = (await worker.recognize(path.join(ROOT, "data", set, "receipts", file))).data.text;
    process.stdout.write(".");
  }
  await worker.terminate();
  writeFileSync(cacheFile, JSON.stringify(cache));
  console.log();
}

let classify = null;
if (useModel) {
  const { pipeline } = await import("@huggingface/transformers");
  classify = await pipeline("zero-shot-classification", MODEL_ID, { dtype: "q8" });
}

const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
const money = (x) => (x == null ? null : x.toFixed(2));

async function score(set) {
  const truth = truths[set];
  const hits = { vendor: 0, date: 0, total: 0, tax: 0, totalCent: 0, catRules: 0, catModel: 0, category: 0, allFive: 0 };
  const misses = [];
  for (const t of truth) {
    const text = cache[`${set}/${t.file}`];
    const f = extractFields(text);
    const fin = await finalCategory(classify, f, text);
    const ok = {
      vendor: norm(f.vendor) === norm(t.vendor),
      date: f.date === t.date,
      total: money(f.total) === money(t.total),
      tax: money(f.tax) === money(t.tax),
      category: fin.category === t.category,
    };
    for (const k of Object.keys(ok)) if (ok[k]) hits[k]++;
    if (f.total != null && Math.abs(f.total - t.total) <= 0.01 + 1e-9) hits.totalCent++;
    if (f.category === t.category) hits.catRules++;
    if (classify && (await categoryByModel(classify, f, text)).category === t.category) hits.catModel++;
    if (Object.values(ok).every(Boolean)) hits.allFive++;
    for (const [k, v] of Object.entries(ok)) if (!v) misses.push({ file: t.file, field: k, want: t[k], got: k === "category" ? fin.category : f[k] });
  }
  const n = truth.length;
  const pct = (k) => ({ pct: +((100 * hits[k]) / n).toFixed(1), hit: hits[k], n });
  return {
    receipts: n,
    vendor: pct("vendor"),
    date: pct("date"),
    total: pct("total"),
    tax: pct("tax"),
    category: pct("category"),
    categoryRulesOnly: pct("catRules"),
    categoryModelOnly: useModel ? pct("catModel") : null,
    totalWithinOneCent: pct("totalCent"),
    allFiveCorrect: pct("allFive"),
    misses,
  };
}

const results = { ocr: "tesseract.js 5 (eng)", model: useModel ? MODEL_ID : null };
for (const set of SETS) results[set] = await score(set);
writeFileSync(path.join(ROOT, "bench/results.json"), JSON.stringify(results, null, 1) + "\n");

const { dev, holdout } = results;
const cell = (r) => `${r.pct}% (${r.hit}/${r.n})`;
const row = (name, k) => `| ${name} | ${cell(holdout[k])} | ${cell(dev[k])} |`;
const table = [
  `Measured on synthetic receipt images made by \`bench/generate.py\` (12 fonts, 5 date formats, 6 total labels, rotation up to 2.5 degrees, blur and speckle noise). OCR by ${results.ocr}${useModel ? `, category model \`${MODEL_ID}\`` : ""}. The rules were tuned on the dev set. The held-out set uses a different seed and was not tuned on.`,
  "",
  `| Field (exact match) | Held-out set (${holdout.receipts}) | Dev set (${dev.receipts}) |`,
  "|---|---|---|",
  row("Vendor (case-insensitive)", "vendor"),
  row("Date", "date"),
  row("Total", "total"),
  row("Tax", "tax"),
  row("Category (rules, model when no keyword)", "category"),
  row("**Total within 1 cent**", "totalWithinOneCent"),
  row("All five fields right on one receipt", "allFiveCorrect"),
  "",
  `Category on its own, held-out set: keyword rules ${holdout.categoryRulesOnly.pct}%${useModel ? `, zero-shot model alone ${holdout.categoryModelOnly.pct}%` : ""}. The keyword list shares words with the generator, so the model-alone number is the fairer guess for real receipts.`,
].join("\n");
const readme = path.join(ROOT, "README.md");
if (existsSync(readme)) {
  const s = readFileSync(readme, "utf8");
  writeFileSync(readme, s.replace(/<!-- bench:start -->[\s\S]*<!-- bench:end -->/, `<!-- bench:start -->\n${table}\n<!-- bench:end -->`));
}
console.log(table);
console.log(`misses: dev ${dev.misses.length}, holdout ${holdout.misses.length} (bench/results.json)`);
