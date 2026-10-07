import ExcelJS from "exceljs";
import { parseCsv } from "./importer.js";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_IMPORT_ROWS = 5000;
const DEFAULT_UOMS = ["BAG", "KG", "MT", "TRUCK", "SHEET", "CFT", "NOS"];

// ---------- column help, sample rows and dropdowns (used by templates) ----------
const HELP = {
  ITEMS: {
    sku: ["Unique stock-keeping code. Letters, numbers, . _ / - (max 40).", "e.g. CEM-UT-PPC-50"],
    name: ["Item name.", ""],
    hsn: ["HSN code: 4, 6 or 8 digits.", "2523"],
    gst_rate: ["GST rate percent, 0 to 100.", "0, 5, 12, 18, 28"],
    base_uom: ["Base unit of measure. Must already exist.", "{uom}"],
    batch_tracked: ["Track stock by batch.", "true / false"],
    valuation: ["Stock valuation method (default FIFO).", "FIFO / WAVG"],
    brand: ["Optional brand.", ""],
    category: ["Optional category.", ""],
  },
  WAREHOUSES: {
    name: ["Unique godown name.", ""],
    notes: ["Optional description.", ""],
    allow_negative: ["Allow stock to go negative.", "true / false"],
    default_uom: ["Default unit (default NOS). Must already exist.", "{uom}"],
    default_reorder: ["Default reorder point, zero or more.", ""],
    max_stock: ["Maximum stock, zero or more and not below the reorder point.", ""],
  },
  PARTIES: {
    name: ["Unique party name.", ""],
    party_type: ["Customer or supplier (default CUSTOMER).", "CUSTOMER / SUPPLIER"],
    gstin: ["15-character GSTIN, optional.", "36ABCDE1234F1Z5"],
    mobile: ["10 to 15 digits, optional.", "9876543210"],
    credit_limit: ["Credit limit in rupees, zero or more.", ""],
    terms: ["Payment terms (default Net 30).", "Net 30"],
    status: ["Account status (default ACTIVE).", "ACTIVE / ON_HOLD / CREDIT_WATCH"],
    preferred: ["Preferred party.", "true / false"],
  },
};

export const SAMPLE_ROWS = {
  ITEMS: [
    { sku: "DEMO-CEM-50", name: "Demo cement 50kg bag", hsn: "2523", gst_rate: "28", base_uom: "BAG", batch_tracked: "true", valuation: "FIFO", brand: "DemoBrand", category: "Cement" },
    { sku: "DEMO-TMT-12", name: "Demo TMT bar 12mm", hsn: "7214", gst_rate: "18", base_uom: "MT", batch_tracked: "true", valuation: "WAVG", brand: "", category: "Steel" },
    { sku: "DEMO-SAND-1", name: "Demo river sand", hsn: "2505", gst_rate: "5", base_uom: "CFT", batch_tracked: "false", valuation: "FIFO", brand: "", category: "Aggregates" },
  ],
  WAREHOUSES: [
    { name: "Demo Godown A", notes: "Main yard", allow_negative: "false", default_uom: "BAG", default_reorder: "100", max_stock: "1000" },
    { name: "Demo Godown B", notes: "Overflow", allow_negative: "true", default_uom: "NOS", default_reorder: "10", max_stock: "500" },
  ],
  PARTIES: [
    { name: "Demo Customer Traders", party_type: "CUSTOMER", gstin: "36ABCDE1234F1Z5", mobile: "9876543210", credit_limit: "50000", terms: "Net 30", status: "ACTIVE", preferred: "false" },
    { name: "Demo Supplier Cements", party_type: "SUPPLIER", gstin: "", mobile: "9123456780", credit_limit: "0", terms: "Net 15", status: "ACTIVE", preferred: "true" },
  ],
};

// ---------- reading ----------
const cellText = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellText(v.result);          // formula
    if ("text" in v) return cellText(v.text);              // hyperlink
    if ("error" in v) return "";
  }
  return typeof v === "boolean" ? (v ? "true" : "false") : String(v);
};

export async function rowsFromXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new Error("The file is not a valid .xlsx workbook"); }
  const sheets = wb.worksheets;
  const skip = new Set(["instructions", "lists", "readme"]);
  const sheet = sheets.find((s) => s.name.toLowerCase() === "data") || sheets.find((s) => !skip.has(s.name.toLowerCase())) || sheets[0];
  if (!sheet) throw new Error("The workbook has no sheets");
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => rows.push(row.values.slice(1).map(cellText)));
  return rowsToObjects(rows);
}

function rowsToObjects(rows) {
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!nonEmpty.length) return [];
  const [head, ...body] = nonEmpty;
  const keys = head.map((h) => String(h).trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""]).filter(([k]) => k)));
}

export function rowsFromJson(body) {
  let list = body;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { throw new Error("The file is not valid JSON"); } }
  if (list && !Array.isArray(list) && typeof list === "object") {
    list = list.rows ?? list.data ?? list.items ?? list.warehouses ?? list.parties;
  }
  if (!Array.isArray(list) || list.some((x) => !x || typeof x !== "object" || Array.isArray(x))) {
    throw new Error("JSON must be an array of objects, e.g. [{\"name\":\"Main godown\"}]");
  }
  return list;
}

export { parseCsv };

// Builds the CSV-export or xlsx-export URL for a shared Google Sheet. Only docs.google.com
// spreadsheet links are accepted; the host and path are rebuilt, never copied from user input.
export function googleSheetExportUrl(input) {
  const m = String(input || "").trim().match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#]|$)/);
  if (!m) return null;
  const gid = String(input).match(/[#&?]gid=(\d{1,12})/)?.[1];
  const base = `https://docs.google.com/spreadsheets/d/${m[1]}/export`;
  return gid ? { url: `${base}?format=csv&gid=${gid}`, format: "csv" } : { url: `${base}?format=xlsx`, format: "xlsx" };
}

// ---------- templates ----------
export async function buildTemplate(type, columns, requiredCols, { sample = false, uoms = DEFAULT_UOMS } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(14, c.length + 4), style: { numFmt: "@" } }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  columns.forEach((c, i) => {
    head.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: requiredCols.includes(c) ? "FFFDE68A" : "FFE5E7EB" } };
  });
  if (sample) SAMPLE_ROWS[type].forEach((r) => ws.addRow(columns.map((c) => r[c] ?? "")));

  const uomList = `"${uoms.join(",")}"`;
  const lists = {
    base_uom: uomList, default_uom: uomList,
    batch_tracked: '"true,false"', allow_negative: '"true,false"', preferred: '"true,false"',
    valuation: '"FIFO,WAVG"', party_type: '"CUSTOMER,SUPPLIER"', status: '"ACTIVE,ON_HOLD,CREDIT_WATCH"',
  };
  const last = 1000;
  columns.forEach((c, i) => {
    const col = i + 1;
    for (let r = 2; r <= last; r++) {
      const cell = ws.getCell(r, col);
      cell.numFmt = "@";
      if (lists[c]) cell.dataValidation = { type: "list", allowBlank: true, formulae: [lists[c]], showErrorMessage: true, errorTitle: "Invalid value", error: `Choose a value from the list for ${c}` };
      else if (c === "gst_rate") cell.dataValidation = { type: "decimal", operator: "between", allowBlank: true, formulae: [0, 100], showErrorMessage: true, error: "GST rate must be between 0 and 100" };
    }
  });

  const ins = wb.addWorksheet("Instructions");
  ins.columns = [{ header: "Column", width: 18 }, { header: "Required", width: 10 }, { header: "Description", width: 60 }, { header: "Allowed / example", width: 36 }];
  ins.getRow(1).font = { bold: true };
  for (const c of columns) {
    const [desc, ex] = HELP[type][c] || ["", ""];
    ins.addRow([c, requiredCols.includes(c) ? "Yes" : "No", desc, ex.replace("{uom}", uoms.join(", "))]);
  }
  ins.addRow([]);
  ins.addRow(["Fill in the Data sheet only. Keep the header row. Delete any sample rows before uploading real data. Save as .xlsx (or export the sheet as CSV)."]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
