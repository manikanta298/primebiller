import { Router } from "express";
import express from "express";
import { pool, q } from "../db.js";
import { ORG } from "../org.js";
import { syncSettingsForItem, syncSettingsForWarehouse } from "../services/inventory/masterSync.js";
import { parseCsv, suggestUom } from "../importer.js";
import { XLSX_MIME, MAX_IMPORT_ROWS, canonicalHeader, rowsFromXlsx, rowsFromJson, googleSheetExportUrl, buildTemplate, SAMPLE_ROWS } from "../importFormats.js";

const r = Router();

export const TYPES = {
  ITEMS: { label: "Items", required: ["sku","name","hsn","gst_rate","base_uom"], columns: ["sku","name","hsn","gst_rate","base_uom","batch_tracked","valuation","brand","category"] },
  WAREHOUSES: { label: "Warehouses", required: ["name"], columns: ["name","notes","allow_negative","default_uom","default_reorder","max_stock"] },
  PARTIES: { label: "Parties", required: ["name"], columns: ["name","party_type","gstin","mobile","credit_limit","terms","status","preferred"] },
};

const normalizeType = (value) => String(value || "").trim().toUpperCase();
const asBool = (value) => ["1","true","yes","y"].includes(String(value || "").trim().toLowerCase()) ? 1 : 0;
const required = (p, key) => String(p[key] ?? "").trim();
const validNumber = (v) => /^\d+(\.\d+)?$/.test(String(v ?? "").trim());
const UOM_SYNONYMS = { PCS: "NOS", PC: "NOS", PIECE: "NOS", PIECES: "NOS", NO: "NOS", UNIT: "NOS", UNITS: "NOS", EA: "NOS", KGS: "KG", KILOGRAM: "KG", KILOGRAMS: "KG", TON: "MT", TONS: "MT", TONNE: "MT", TONNES: "MT", BAGS: "BAG", SHEETS: "SHEET", TRUCKS: "TRUCK" };
const tidy = {
  base_uom: (v) => { const u = v.toUpperCase(); return UOM_SYNONYMS[u] || suggestUom(u) || v; },
  default_uom: (v) => { const u = v.toUpperCase(); return UOM_SYNONYMS[u] || suggestUom(u) || v; },
  hsn: (v) => (/^\d+$/.test(v) && [3, 5, 7].includes(v.length) ? "0" + v : v),          // Excel drops the leading zero (0902 -> 902)
  gst_rate: (v) => v.replace(/%$/, "").trim(),                                          // "18%" -> "18"
  mobile: (v) => { const d = v.replace(/[\s\-()]/g, ""); const m = d.match(/^(?:\+?91|0)(\d{10})$/); return m ? m[1] : d; }, // "+91 98765-43210" -> 9876543210
  gstin: (v) => v.replace(/\s/g, "").toUpperCase(),
};
export const cleanRow = (p, type) => Object.fromEntries(Object.entries(p).map(([k,v]) => {
  const key = canonicalHeader(type, k);
  const val = v === true ? "true" : v === false ? "false" : String(v ?? "").trim();
  return [key, tidy[key] ? tidy[key](val) : val];
}));
const normalizeRows = (type, data) => data.map((p) => cleanRow(p, type));

const validateHeaders = (type, data) => {
  const found = Object.keys(data[0] || {});
  const missing = TYPES[type].required.filter((x) => !found.includes(x));
  if (!missing.length) return null;
  const seen = found.length ? found.slice(0, 12).join(", ") : "(none)";
  return `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Columns found: ${seen}. Download the template to see the expected headers.`;
};

// `excludeId` lets an edit be validated without the record colliding with itself.
const existingSets = async (type, excludeId = null) => {
  const skip = excludeId == null ? "" : " AND id<>?";
  const args = excludeId == null ? [ORG] : [ORG, excludeId];
  if (type === "ITEMS") return new Set((await q("SELECT sku FROM items WHERE org_id=?" + skip, args)).map((x) => String(x.sku).toLowerCase()));
  if (type === "WAREHOUSES") return new Set((await q("SELECT name FROM warehouses WHERE org_id=?" + skip, args)).map((x) => String(x.name).trim().toLowerCase()));
  return new Set((await q("SELECT name FROM parties WHERE org_id=?" + skip, args)).map((x) => String(x.name).trim().toLowerCase()));
};
const uomSet = async () => new Set((await q("SELECT code FROM uoms")).map((x) => String(x.code).toUpperCase()));

const validateItem = (p, seen, existing, uoms) => {
  if (!required(p,"sku")) return ["REQUIRED","SKU is required","sku"];
  if (!/^[A-Za-z0-9._\/-]{1,40}$/.test(p.sku)) return ["SKU","SKU must be 1–40 letters, numbers, dot, underscore, slash or hyphen","sku"];
  if (seen.has(p.sku.toLowerCase())) return ["DUP","Duplicate SKU within the file","sku"];
  if (existing.has(p.sku.toLowerCase())) return ["EXISTS","SKU already exists in this organization","sku"];
  if (!required(p,"name")) return ["REQUIRED","Item name is required","name"];
  if (!/^(\d{4}|\d{6}|\d{8})$/.test(p.hsn)) return ["HSN","HSN must be 4, 6 or 8 digits","hsn"];
  if (!validNumber(p.gst_rate) || Number(p.gst_rate) < 0 || Number(p.gst_rate) > 100) return ["GST","GST rate must be between 0 and 100","gst_rate"];
  if (!uoms.has(String(p.base_uom).toUpperCase())) return ["UOM","Base UOM does not exist","base_uom"];
  if (p.batch_tracked && !["1","0","true","false","yes","no","y"].includes(p.batch_tracked.toLowerCase())) return ["BOOL","batch_tracked must be true/false or 1/0","batch_tracked"];
  if (p.valuation && !["FIFO","WAVG"].includes(p.valuation.toUpperCase())) return ["VALUATION","Valuation must be FIFO or WAVG","valuation"];
  seen.add(p.sku.toLowerCase());
  return null;
};

const validateWarehouse = (p, seen, existing, uoms) => {
  const name = required(p,"name");
  if (!name) return ["REQUIRED","Warehouse name is required","name"];
  if (name.length > 100) return ["LENGTH","Warehouse name must be 100 characters or fewer","name"];
  const key = name.toLowerCase();
  if (seen.has(key)) return ["DUP","Duplicate warehouse name within the file","name"];
  if (existing.has(key)) return ["EXISTS","Warehouse name already exists in this organization","name"];
  if (p.allow_negative && !["1","0","true","false","yes","no","y"].includes(p.allow_negative.toLowerCase())) return ["BOOL","allow_negative must be true/false or 1/0","allow_negative"];
  if (p.default_uom && !uoms.has(p.default_uom.toUpperCase())) return ["UOM","Default UOM does not exist","default_uom"];
  if (p.default_reorder && (!validNumber(p.default_reorder) || Number(p.default_reorder) < 0)) return ["NUMBER","default_reorder must be zero or greater","default_reorder"];
  if (p.max_stock && (!validNumber(p.max_stock) || Number(p.max_stock) < 0)) return ["NUMBER","max_stock must be zero or greater","max_stock"];
  if (p.max_stock && p.default_reorder && Number(p.max_stock) < Number(p.default_reorder)) return ["RANGE","max_stock cannot be less than default_reorder","max_stock"];
  seen.add(key);
  return null;
};

const gstin = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const validateParty = (p, seen, existing) => {
  const name = required(p,"name");
  if (!name) return ["REQUIRED","Party name is required","name"];
  if (name.length > 150) return ["LENGTH","Party name must be 150 characters or fewer","name"];
  const key = name.toLowerCase();
  if (seen.has(key)) return ["DUP","Duplicate party name within the file","name"];
  if (existing.has(key)) return ["EXISTS","Party name already exists in this organization","name"];
  if (!["CUSTOMER","SUPPLIER"].includes(String(p.party_type || "CUSTOMER").toUpperCase())) return ["TYPE","party_type must be CUSTOMER or SUPPLIER","party_type"];
  if (p.gstin && !gstin.test(p.gstin.toUpperCase())) return ["GSTIN","GSTIN format is invalid","gstin"];
  if (p.mobile && !/^\d{10,15}$/.test(p.mobile)) return ["MOBILE","Mobile must contain 10–15 digits","mobile"];
  if (p.credit_limit && (!validNumber(p.credit_limit) || Number(p.credit_limit) < 0)) return ["NUMBER","credit_limit must be zero or greater","credit_limit"];
  if (p.status && !["ACTIVE","ON_HOLD","CREDIT_WATCH"].includes(p.status.toUpperCase())) return ["STATUS","status must be ACTIVE, ON_HOLD or CREDIT_WATCH","status"];
  if (p.preferred && !["1","0","true","false","yes","no","y"].includes(p.preferred.toLowerCase())) return ["BOOL","preferred must be true/false or 1/0","preferred"];
  seen.add(key);
  return null;
};

const keyOf = (type, p) => String(type === "ITEMS" ? p.sku : p.name).trim().toLowerCase();

// `seen` can be pre-seeded (see the PATCH route) so a single edited row is still
// checked against the other rows in the same file.
export const validate = async (type, rows, seen = new Set(), excludeId = null) => {
  const existing = await existingSets(type, excludeId);
  const uoms = await uomSet();
  return rows.map((p, i) => {
    const bad = type === "ITEMS" ? validateItem(p, seen, existing, uoms) : type === "WAREHOUSES" ? validateWarehouse(p, seen, existing, uoms) : validateParty(p, seen, existing);
    return [i + 1, JSON.stringify(p), bad?.[0] || null, bad?.[1] || null, bad?.[2] || null];
  });
};

const summary = async (id) => {
  const [job] = await q("SELECT * FROM import_jobs WHERE id=? AND org_id=?", [id, ORG]);
  if (!job || !TYPES[job.import_type]) return null;
  const [counts] = await q("SELECT COUNT(*) total,SUM(error_kind IS NULL) valid,SUM(error_kind IS NOT NULL) errors,SUM(fixed) fixed,SUM(error_kind IS NOT NULL AND fixed=0) remaining FROM import_rows WHERE job_id=?", [id]);
  const kinds = await q("SELECT error_kind kind,COUNT(*) AS `rows` FROM import_rows WHERE job_id=? AND error_kind IS NOT NULL GROUP BY error_kind ORDER BY `rows` DESC", [id]);
  return { job, counts, kinds };
};

const loadTypedJob = async (id) => {
  const [job] = await q("SELECT id,import_type FROM import_jobs WHERE id=? AND org_id=?", [id, ORG]);
  return job && TYPES[job.import_type] ? job : null;
};

for (const [type, meta] of Object.entries(TYPES)) {
  r.get(`/imports/templates/${type.toLowerCase()}.csv`, (_req, res) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${type.toLowerCase()}-template.csv"`);
    const example = type === "ITEMS"
      ? ["SKU-001","Sample item","271019","18","NOS","true","FIFO","Brand","Category"]
      : type === "WAREHOUSES"
        ? ["Main Warehouse","Primary stock location","false","NOS","10","1000"]
        : ["Sample Customer","CUSTOMER","36ABCDE1234F1Z5","9876543210","50000","Net 30","ACTIVE","false"];
    res.send(meta.columns.join(",") + "\n" + example.map((x) => `"${String(x).replace(/"/g,'""')}"`).join(",") + "\n");
  });
}

for (const [type, meta] of Object.entries(TYPES)) {
  const slug = type.toLowerCase();
  // ?sample=1 fills the template with a few dummy rows.
  r.get(`/imports/templates/${slug}.xlsx`, async (req, res) => {
    const uoms = (await q("SELECT code FROM uoms ORDER BY code")).map((x) => x.code);
    const buf = await buildTemplate(type, meta.columns, meta.required, { sample: req.query.sample === "1", uoms: uoms.length ? uoms : undefined });
    res.setHeader("Content-Type", XLSX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${slug}-${req.query.sample === "1" ? "sample" : "template"}.xlsx"`);
    res.send(buf);
  });
  r.get(`/imports/templates/${slug}.json`, (req, res) => {
    const rows = req.query.sample === "1" ? SAMPLE_ROWS[type] : [Object.fromEntries(meta.columns.map((c) => [c, ""]))];
    res.setHeader("Content-Disposition", `attachment; filename="${slug}-${req.query.sample === "1" ? "sample" : "template"}.json"`);
    res.json(rows);
  });
}

// Shared by file upload and Google Sheets import: validate rows, create the job, return its summary.
const createJob = async (res, type, rawRows, filename) => {
  const data = normalizeRows(type, rawRows);
  if (!data.length) return res.status(422).json({ error: "No data rows found. Put the column headers in one row and at least one record under it (replace the sample rows in the template)." });
  if (data.length > MAX_IMPORT_ROWS) return res.status(422).json({ error: `Too many rows (${data.length}). Import at most ${MAX_IMPORT_ROWS} rows at a time.` });
  const headerError = validateHeaders(type, data);
  if (headerError) return res.status(422).json({ error: headerError });
  const vals = await validate(type, data);
  const job = await q("INSERT INTO import_jobs (org_id,filename,import_type,status,rows_total) VALUES (?,?,?,'VALIDATED',?)", [ORG, filename, type, data.length]);
  for (let i = 0; i < vals.length; i += 500) await q("INSERT INTO import_rows (job_id,row_no,payload,error_kind,error_msg,error_field) VALUES ?", [vals.slice(i, i + 500).map((x) => [job.insertId, ...x])]);
  return res.status(201).json(await summary(job.insertId));
};

// Accepts CSV (text/csv), Excel (.xlsx) or JSON (application/json) bodies.
r.post("/imports",
  express.text({ type: "text/csv", limit: "20mb" }),
  express.raw({ type: XLSX_MIME, limit: "20mb" }),
  async (req, res, next) => {
    const type = normalizeType(req.query.type);
    if (!TYPES[type]) return next();
    let rows;
    try {
      if (req.is("text/csv")) rows = parseCsv(String(req.body || ""));
      else if (req.is(XLSX_MIME)) rows = await rowsFromXlsx(req.body, { type, columns: TYPES[type].columns });
      else if (req.is("json")) rows = rowsFromJson(req.body);
      else return res.status(415).json({ error: "Upload a .csv, .xlsx or .json file" });
    } catch (e) {
      return res.status(422).json({ error: e.message });
    }
    return createJob(res, type, rows, String(req.query.filename || `${type.toLowerCase()}-import`).slice(0, 150));
  });

// Import straight from a Google Sheet shared as "Anyone with the link can view".
r.post("/imports/from-sheet", async (req, res, next) => {
  const type = normalizeType(req.body?.type);
  if (!TYPES[type]) return next();
  const target = googleSheetExportUrl(req.body?.url);
  if (!target) return res.status(422).json({ error: "Paste a Google Sheets link that starts with https://docs.google.com/spreadsheets/d/" });
  let rows;
  try {
    const resp = await fetch(target.url, { signal: AbortSignal.timeout(20_000) });
    const kind = resp.headers.get("content-type") || "";
    if (!resp.ok || kind.includes("text/html")) throw new Error("not-public");
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) return res.status(422).json({ error: "The sheet is larger than 20 MB" });
    rows = target.format === "csv" ? parseCsv(buf.toString("utf8")) : await rowsFromXlsx(buf, { type, columns: TYPES[type].columns });
  } catch (e) {
    return res.status(422).json({ error: e.message === "not-public" || e.name === "TimeoutError" || e.name === "TypeError"
      ? "Could not read the sheet. Set sharing to “Anyone with the link can view” and try again."
      : e.message });
  }
  return createJob(res, type, rows, "google-sheet");
});

r.get("/imports/:id", async (req, res, next) => {
  if (!await loadTypedJob(req.params.id)) return next();
  res.json(await summary(req.params.id));
});

r.get("/imports/:id/rows", async (req, res, next) => {
  if (!await loadTypedJob(req.params.id)) return next();
  const only = String(req.query.errorsOnly || "") === "1";
  const limit = Math.min(MAX_IMPORT_ROWS, Math.max(1, Number(req.query.limit) || MAX_IMPORT_ROWS));
  const offset = Math.max(0, Number(req.query.offset ?? req.query.cursor ?? 0));
  const rows = await q(`SELECT row_no,payload,error_kind,error_msg,error_field,fixed FROM import_rows WHERE job_id=? ${only ? "AND error_kind IS NOT NULL AND fixed=0" : ""} ORDER BY row_no LIMIT ? OFFSET ?`, [req.params.id, limit, offset]);
  res.json(rows);
});

r.patch("/imports/:id/rows/:no", async (req, res, next) => {
  const job = await loadTypedJob(req.params.id);
  if (!job) return next();
  const [row] = await q("SELECT payload FROM import_rows WHERE job_id=? AND row_no=?", [req.params.id, req.params.no]);
  if (!row) return res.status(404).json({ error: "Row not found" });
  const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  if (!req.body?.field || !Object.prototype.hasOwnProperty.call(p, req.body.field)) return res.status(422).json({ error: "Invalid import field" });
  p[req.body.field] = String(req.body.value ?? "").trim();
  const others = await q("SELECT payload FROM import_rows WHERE job_id=? AND row_no<>? AND (error_kind IS NULL OR fixed=1)", [req.params.id, req.params.no]);
  const seen = new Set(others.map((x) => keyOf(job.import_type, typeof x.payload === "string" ? JSON.parse(x.payload) : x.payload)));
  const [one] = await validate(job.import_type, [p], seen);
  if (one[2]) return res.status(422).json({ error: one[3] });
  await q("UPDATE import_rows SET payload=?,error_kind=NULL,error_msg=NULL,error_field=NULL,fixed=1 WHERE job_id=? AND row_no=?", [JSON.stringify(p), req.params.id, req.params.no]);
  res.json(await summary(req.params.id));
});

r.post("/imports/:id/cancel", async (req, res, next) => {
  if (!await loadTypedJob(req.params.id)) return next();
  await q("UPDATE import_jobs SET status='CANCELLED' WHERE id=? AND org_id=? AND status='VALIDATED'", [req.params.id, ORG]);
  res.json(await summary(req.params.id));
});

const existsSql = {
  ITEMS: ["SELECT 1 FROM items WHERE org_id=? AND sku=? LIMIT 1", (p) => p.sku],
  WAREHOUSES: ["SELECT 1 FROM warehouses WHERE org_id=? AND LOWER(TRIM(name))=? LIMIT 1", (p) => p.name.trim().toLowerCase()],
  PARTIES: ["SELECT 1 FROM parties WHERE org_id=? AND LOWER(TRIM(name))=? LIMIT 1", (p) => p.name.trim().toLowerCase()],
};

export const masterExists = async (c, type, p) => {
  const [checkSql, checkKey] = existsSql[type];
  const [dupe] = await c.query(checkSql, [ORG, checkKey(p)]);
  return dupe.length > 0;
};

// Inserts one already-validated master record and returns its id.
export const insertMaster = async (c, type, p) => {
  let res;
  if (type === "ITEMS") {
    [res] = await c.query("INSERT INTO items (org_id,sku,name,brand,category,hsn,gst_rate,base_uom,batch_tracked,valuation) VALUES (?,?,?,?,?,?,?,?,?,?)", [ORG,p.sku,p.name,p.brand||null,p.category||null,p.hsn,Number(p.gst_rate),String(p.base_uom).toUpperCase(),asBool(p.batch_tracked),p.valuation ? p.valuation.toUpperCase() : "FIFO"]);
  } else if (type === "WAREHOUSES") {
    [res] = await c.query("INSERT INTO warehouses (org_id,name,notes,allow_negative,default_uom,default_reorder,max_stock) VALUES (?,?,?,?,?,?,?)", [ORG,p.name,p.notes||null,asBool(p.allow_negative),String(p.default_uom||"NOS").toUpperCase(),Number(p.default_reorder||0),p.max_stock ? Number(p.max_stock) : null]);
  } else {
    [res] = await c.query("INSERT INTO parties (org_id,name,gstin,mobile,credit_limit,terms,party_type,status,preferred) VALUES (?,?,?,?,?,?,?,?,?)", [ORG,p.name,p.gstin ? p.gstin.toUpperCase() : null,p.mobile||null,Number(p.credit_limit||0),p.terms||"Net 30",String(p.party_type||"CUSTOMER").toUpperCase(),String(p.status||"ACTIVE").toUpperCase(),asBool(p.preferred)]);
  }
  if (type === "ITEMS") await syncSettingsForItem(c, res.insertId);
  else if (type === "WAREHOUSES") await syncSettingsForWarehouse(c, res.insertId);
  return res.insertId;
};

// Updates one already-validated master record (same value conversions as insertMaster).
export const updateMaster = async (c, type, id, p) => {
  if (type === "ITEMS") await c.query("UPDATE items SET sku=?,name=?,brand=?,category=?,hsn=?,gst_rate=?,base_uom=?,batch_tracked=?,valuation=? WHERE id=? AND org_id=?", [p.sku,p.name,p.brand||null,p.category||null,p.hsn,Number(p.gst_rate),String(p.base_uom).toUpperCase(),asBool(p.batch_tracked),p.valuation ? p.valuation.toUpperCase() : "FIFO",id,ORG]);
  else await c.query("UPDATE parties SET name=?,gstin=?,mobile=?,credit_limit=?,terms=?,party_type=?,status=?,preferred=? WHERE id=? AND org_id=?", [p.name,p.gstin ? p.gstin.toUpperCase() : null,p.mobile||null,Number(p.credit_limit||0),p.terms||"Net 30",String(p.party_type||"CUSTOMER").toUpperCase(),String(p.status||"ACTIVE").toUpperCase(),asBool(p.preferred),id,ORG]);
};

r.post("/imports/:id/commit", async (req, res, next) => {
  const job = await loadTypedJob(req.params.id);
  if (!job) return next();
  const c = await pool.getConnection();
  let posted = 0;
  try {
    await c.beginTransaction();
    // Lock the job row so two concurrent commits cannot both pass the status check:
    // the second one waits here, then sees COMMITTED and is rejected.
    const [[j]] = await c.query("SELECT status FROM import_jobs WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (j?.status !== "VALIDATED") {
      await c.rollback();
      return res.status(409).json({ error: "Commit is only allowed from the VALIDATED state" });
    }
    const [rows] = await c.query("SELECT row_no,payload FROM import_rows WHERE job_id=? AND (error_kind IS NULL OR fixed=1) ORDER BY row_no", [req.params.id]);
    for (const x of rows) {
      const p = typeof x.payload === "string" ? JSON.parse(x.payload) : x.payload;
      // Parties and warehouses have no unique key, so re-check against the live table inside the transaction.
      if (await masterExists(c, job.import_type, p)) {
        await c.rollback();
        return res.status(409).json({ error: `Row ${x.row_no} already exists in this organization; nothing was imported`, posted: 0 });
      }
      await insertMaster(c, job.import_type, p);
      posted++;
    }
    await c.query("UPDATE import_jobs SET status='COMMITTED',rows_valid=?,rows_error=? WHERE id=? AND org_id=?", [posted, rows.length === posted ? 0 : rows.length - posted, req.params.id, ORG]);
    await c.commit();
    res.json({ ok:true, posted, type:job.import_type });
  } catch (e) {
    await c.rollback().catch(() => {});
    res.status(e.code === "ER_DUP_ENTRY" ? 409 : 500).json({ error: e.code === "ER_DUP_ENTRY" ? "A row conflicts with an existing master record" : e.message, posted:0 });
  } finally { c.release(); }
});

export default r;
