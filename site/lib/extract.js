// Rule-based field extraction from receipt OCR text. Pure functions, no DOM, runs in the browser and in Node.

export const CATEGORIES = ["Meals", "Fuel", "Office Supplies", "Travel", "Lodging", "Utilities", "Other"];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

// Amount like 1,234.56 / $46.41 / 46,41 / 46. 41. OCR often drops or splits the decimal point.
const AMOUNT_RE = /(?:^|[^\d%])\$?\s?(\d{1,3}(?:[,\s]\d{3})*|\d+)\s?[.,]\s?(\d{2})(?![\d%])/g;

export function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT_RE)) out.push(Number(m[1].replace(/[,\s]/g, "") + "." + m[2]));
  return out;
}

const lastAmount = (line) => amountsIn(line).at(-1);

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);
const fullYear = (y) => (y < 100 ? 2000 + y : y);

export function extractDate(text) {
  const t = text.replace(/[|]/g, "/");
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = t.match(/\b(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](20\d{2})\b/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  m = t.match(/\b(\d{1,2})\s?[/-]\s?(\d{1,2})\s?[/-]\s?(\d{4}|\d{2})\b/);
  if (m) return iso(fullYear(+m[3]), +m[1], +m[2]); // US order: month first
  return null;
}

const TOTAL_RANK = [
  [/grand\s*total/i, 5],
  [/(total|amount|balance)\s*due/i, 4],
  [/\btotal\b/i, 3],
];
const NOT_TOTAL = /sub\W*total|subtota|\btax\b|items?\s+total/i;

export function extractTotal(lines) {
  let best = null;
  lines.forEach((line, i) => {
    if (NOT_TOTAL.test(line)) return;
    const rank = TOTAL_RANK.find(([re]) => re.test(line))?.[1];
    const amt = lastAmount(line);
    if (rank && amt != null && (!best || rank > best.rank)) best = { rank, amt, i };
  });
  return best?.amt ?? null;
}

const TAX_RE = /\b(sales\s*tax|tax|vat|gst|hst|pst)\b/i;

export function extractTax(lines) {
  for (const line of lines) {
    if (!TAX_RE.test(line) || /total|pre-?tax|tax\s*id/i.test(line)) continue;
    const amt = lastAmount(line);
    if (amt != null) return amt;
  }
  return null;
}

export function extractSubtotal(lines) {
  for (const line of lines) if (/sub\W*total|subtota|^\s*net\b/i.test(line)) return lastAmount(line) ?? null;
  return null;
}

const NOT_VENDOR = /^(receipt|invoice|date|tel|phone|www\.|http|order|store\s*#)|\d{3,}|\d+\s+\w+\s+(st|rd|ave|ln|way|blvd)\b/i;

export function extractVendor(lines) {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.replace(/[^A-Za-z0-9&'.,\- ]/g, " ").replace(/\s+/g, " ").trim();
    if ((line.match(/[A-Za-z]/g) || []).length < 4 || NOT_VENDOR.test(line)) continue;
    return line.replace(/[.,\- ]+$/, "");
  }
  return null;
}

const CATEGORY_WORDS = {
  Meals: /diner|cafe|café|bistro|grill|noodle|restaurant|pizza|bar\b|sandwich|burger|coffee|breakfast|salad|soup|lemonade|pancake|meal/i,
  Fuel: /fuel|gas\s*&|petroleum|pump|unleaded|diesel|gallon|car\s*wash/i,
  "Office Supplies": /office|paper|stationer|toner|ink|pens?\b|folder|binder|stapler|sticky|desk/i,
  Travel: /shuttle|airport|rideshare|parking|train|rail|ticket|toll|fare|taxi|airline/i,
  Lodging: /inn\b|lodge|suites?|motel|hotel|room\s*night|resort|checkout/i,
  Utilities: /utility|utilities|power|electric|water\s*service|internet|natural\s*gas|grid/i,
};

// Returns { category, score }; score counts keyword hits so callers can tell a guess from a clear match.
export function categoryByRules(text) {
  let best = { category: "Other", score: 0 };
  for (const [category, re] of Object.entries(CATEGORY_WORDS)) {
    const score = (text.match(new RegExp(re.source, "gi")) || []).length;
    if (score > best.score) best = { category, score };
  }
  return best;
}

export function extractFields(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let total = extractTotal(lines);
  let tax = extractTax(lines);
  const subtotal = extractSubtotal(lines);
  const notes = [];
  // Arithmetic check: subtotal + tax should equal total. Use it to repair or flag.
  if (subtotal != null && tax != null) {
    const sum = Math.round((subtotal + tax) * 100) / 100;
    if (total == null) {
      total = sum;
      notes.push("total computed from subtotal + tax");
    } else if (Math.abs(sum - total) > 0.01) notes.push(`subtotal + tax = ${sum.toFixed(2)}, printed total ${total.toFixed(2)}`);
  }
  if (tax == null && subtotal != null && total != null && total >= subtotal) {
    tax = Math.round((total - subtotal) * 100) / 100;
    notes.push("tax computed from total - subtotal");
  }
  const rules = categoryByRules(text);
  return {
    vendor: extractVendor(lines),
    date: extractDate(text),
    subtotal,
    tax,
    total,
    category: rules.category,
    categoryScore: rules.score,
    notes,
  };
}

const ZS_LABELS = {
  Meals: "restaurant food and drinks",
  Fuel: "gasoline for a car",
  "Office Supplies": "office supplies and stationery",
  Travel: "transportation, parking or tickets",
  Lodging: "hotel room",
  Utilities: "electricity, water or internet bill",
};

// Zero-shot category with a transformers.js pipeline. `classify` is the pipeline function.
export async function categoryByModel(classify, fields, text) {
  const items = text.split(/\r?\n/).filter((l) => amountsIn(l).length && !/total|tax|cash|change|visa|card/i.test(l)).slice(0, 6);
  const input = [fields.vendor, ...items.map((l) => l.replace(AMOUNT_RE, " "))].filter(Boolean).join(". ");
  const out = await classify(input, Object.values(ZS_LABELS), { hypothesis_template: "This receipt is for {}." });
  const label = out.labels[0];
  return { category: Object.keys(ZS_LABELS).find((k) => ZS_LABELS[k] === label), score: out.scores[0] };
}

// Rules first; the model decides only when no keyword matched.
export async function finalCategory(classify, fields, text) {
  if (fields.categoryScore > 0 || !classify) return { category: fields.category, source: "rules" };
  const m = await categoryByModel(classify, fields, text);
  return { category: m.category, source: "model", score: m.score };
}

export function toCsv(rows) {
  const cols = ["file", "vendor", "date", "category", "subtotal", "tax", "total"];
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}
