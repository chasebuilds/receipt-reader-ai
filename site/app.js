import { extractFields, finalCategory, toCsv } from "./lib/extract.js";

const MODEL_ID = "Xenova/mobilebert-uncased-mnli";
const $ = (id) => document.getElementById(id);
const rows = [];
let queue = Promise.resolve();
let pending = 0;

const setPill = (el, text, cls) => { el.textContent = text; el.className = `pill ${cls ?? ""}`; };
const setBusy = (n) => { pending += n; document.body.dataset.busy = pending > 0 ? "1" : "0"; };

const workerReady = Tesseract.createWorker("eng").then((w) => { setPill($("ocrStatus"), "OCR: ready", "ok"); return w; });

// The classifier loads in the background; rows that need it wait for it.
const classifierReady = import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1")
  .then(({ pipeline }) => pipeline("zero-shot-classification", MODEL_ID, { dtype: "q8" }))
  .then((c) => { setPill($("modelStatus"), "Category model: ready", "ok"); return c; })
  .catch((e) => { console.error(e); setPill($("modelStatus"), "Category model: unavailable, rules only", "err"); return null; });

workerReady.then(() => { document.body.dataset.state = "ready"; });

const fmt = (x) => (x == null ? "" : x.toFixed(2));

function render() {
  const tb = $("rows");
  tb.innerHTML = "";
  if (!rows.length) tb.innerHTML = '<tr><td colspan="9" class="empty">Pick a sample or drop a receipt to start.</td></tr>';
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.dataset.state = r.state;
    tr.dataset.file = r.file;
    const edit = (key, cls = "") => `<td contenteditable="${r.state === "done"}" data-key="${key}" class="${cls}">${r[key] ?? ""}</td>`;
    const catTag = r.categorySource ? `<span class="tag ${r.categorySource === "model" ? "ai" : ""}">${r.categorySource === "model" ? "AI" : "rules"}</span>` : "";
    tr.innerHTML = r.state !== "done"
      ? `<td><img src="${r.url}" alt=""></td><td>${r.file}</td><td colspan="7" class="note">${r.state}</td>`
      : `<td><img src="${r.url}" alt=""></td><td>${r.file}</td>${edit("vendor")}${edit("date")}<td data-key="category">${r.category}${catTag}</td>`
        + `${edit("subtotal", "num")}${edit("tax", "num")}${edit("total", "num")}<td class="note${r.notes.length ? "" : " ok"}">${r.notes.join("; ") || "ok"}</td>`;
    tr.querySelectorAll("td[contenteditable=true]").forEach((td) => td.addEventListener("input", () => { rows[i][td.dataset.key] = td.textContent.trim(); }));
    tb.appendChild(tr);
  });
  $("count").textContent = rows.filter((r) => r.state === "done").length;
  $("csv").disabled = $("xlsx").disabled = !rows.some((r) => r.state === "done");
}

async function processOne(row, source) {
  try {
    row.state = "reading text (OCR)";
    render();
    const worker = await workerReady;
    const { data } = await worker.recognize(source);
    $("ocrText").textContent = data.text;
    const f = extractFields(data.text);
    let cat = { category: f.category, source: "rules" };
    if (f.categoryScore === 0) {
      row.state = "asking the category model";
      render();
      cat = await finalCategory(await classifierReady, f, data.text);
    }
    Object.assign(row, {
      vendor: f.vendor ?? "", date: f.date ?? "", subtotal: fmt(f.subtotal), tax: fmt(f.tax), total: fmt(f.total),
      category: cat.category, categorySource: cat.source, notes: f.notes, state: "done",
    });
  } catch (e) {
    console.error(e);
    row.state = `error: ${e.message ?? e}`;
  }
  render();
}

function enqueue(file, source, url) {
  const row = { file, url, state: "queued", notes: [] };
  rows.push(row);
  render();
  setBusy(1);
  queue = queue.then(() => processOne(row, source)).finally(() => setBusy(-1));
  return queue;
}

const addFiles = (files) => [...files].filter((f) => f.type.startsWith("image/")).forEach((f) => { const url = URL.createObjectURL(f); enqueue(f.name, url, url); });

$("file").addEventListener("change", (e) => addFiles(e.target.files));
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });

const samples = await (await fetch("samples/index.json")).json();
const runSample = (s) => enqueue(s.file, `samples/${s.file}`, `samples/${s.file}`);
for (const s of samples) {
  const b = document.createElement("button");
  b.dataset.sample = s.file;
  b.innerHTML = `<img src="samples/${s.file}" alt="Sample receipt from ${s.vendor}" loading="lazy"><span>${s.vendor}</span>`;
  b.addEventListener("click", () => runSample(s));
  $("samples").appendChild(b);
}
$("runAll").addEventListener("click", () => samples.forEach(runSample));

const COLS = ["file", "vendor", "date", "category", "subtotal", "tax", "total"];
const done = () => rows.filter((r) => r.state === "done");
function download(name, blob) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("csv").addEventListener("click", () => download("receipts.csv", new Blob([toCsv(done())], { type: "text/csv" })));
$("xlsx").addEventListener("click", () => {
  const data = done().map((r) => Object.fromEntries(COLS.map((c) => [c, ["subtotal", "tax", "total"].includes(c) && r[c] !== "" ? Number(r[c]) : r[c]])));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data, { header: COLS }), "Receipts");
  download("receipts.xlsx", new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })]));
});
