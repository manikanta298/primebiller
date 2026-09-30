// Row validation shared by upload, inline edit, bulk fixes and the demo seed.
export const KINDS = { UOM: "Unknown UOM code", HSN: "HSN not 4, 6 or 8 digits", DUP: "Duplicate SKU within the file", RATE: "Rate is not a number", GODOWN: "Godown name not found", NEG: "Negative opening quantity" };
const UOMS = ["BAG", "KG", "MT", "TRUCK", "SHEET", "CFT", "NOS"];

export const suggestUom = (u) => { const v = String(u || "").trim().toUpperCase(); return UOMS.includes(v) ? v : UOMS.find((x) => v === x + "S" || v.replace(/S$/, "") === x || (v.length > 2 && x.startsWith(v.slice(0, 3)))) || null; };

// returns { kind, msg } or null
export function validateRow(p, { godowns, seenSkus }) {
  if (!UOMS.includes(String(p.uom).trim().toUpperCase())) { const s = suggestUom(p.uom); return { kind: "UOM", msg: s ? `Unknown UOM. Did you mean ${s}?` : "Unknown UOM." }; }
  if (!/^(\d{4}|\d{6}|\d{8})$/.test(String(p.hsn).trim())) return { kind: "HSN", msg: "HSN must be 4, 6 or 8 digits" };
  if (seenSkus?.has(p.sku)) return { kind: "DUP", msg: `Duplicate of row ${seenSkus.get(p.sku)}` };
  if (!/^\d+(\.\d+)?$/.test(String(p.rate).trim())) return { kind: "RATE", msg: /o/i.test(String(p.rate)) ? "Letter O in a numeric field" : "Rate is not a number" };
  if (godowns && !godowns.map((g) => g.toLowerCase()).includes(String(p.godown).trim().toLowerCase())) return { kind: "GODOWN", msg: "Godown not found" };
  if (Number(p.qty) < 0) return { kind: "NEG", msg: "Opening quantity cannot be negative" };
  return null;
}

export function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += ch; }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const ones = "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen".split(" ");
const tens = "  Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split(" ");
const two = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
export function inrWords(amount) {
  let n = Math.floor(amount); if (!n) return "Rupees Zero Only";
  const parts = [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [100, "Hundred"]]; const out = [];
  for (const [d, w] of parts) { const k = Math.floor(n / d); if (k) { out.push(`${two(k)} ${w}`); n %= d; } }
  if (n) out.push(two(n));
  const paise = Math.round((amount - Math.floor(amount)) * 100);
  return `Rupees ${out.join(" ")}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}
