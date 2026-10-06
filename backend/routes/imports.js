import { Router } from "express";
import express from "express";
import { pool, q } from "../db.js";
import { ORG } from "../org.js";
import { parseCsv } from "../importer.js";

const r = Router();

const TYPES = {
  ITEMS: { label: "Items", columns: ["sku","name","hsn","gst_rate","base_uom","batch_tracked","valuation","brand","category"] },
  WAREHOUSES: { label: "Warehouses", columns: ["name","notes","allow_negative","default_uom","default_reorder","max_stock"] },
  PARTIES: { label: "Parties", columns: ["name","party_type","gstin","mobile","credit_limit","terms","status","preferred"] },
};

const normalizeType = (value) => String(value || "").trim().toUpperCase();
const asBool = (value) => ["1","true","yes","y"].includes(String(value || "").trim().toLowerCase()) ? 1 : 0;
const required = (p, key) => String(p[key] ?? "").trim();
const validNumber = (v) => /^\d+(\.\d+)?$/.test(String(v ?? "").trim());
const normalizeRows = (type, data) => data.map((p) => Object.fromEntries(Object.entries(p).map(([k,v]) => [String(k).trim().toLowerCase(), String(v ?? "").trim()])));

const validateHeaders = (type, data) => {
  const missing = TYPES[type].columns.filter((x) => !Object.keys(data[0] || {}).includes(x));
  return missing.length ? `Missing required CSV columns: ${missing.join(", ")}` : null;
};

const existingSets = async (type) => {
  if (type === "ITEMS") return new Set((await q("SELECT sku FROM items WHERE org_id=?", [ORG])).map((x) => String(x.sku).toLowerCase()));
  if (type === "WAREHOUSES") return new Set((await q("SELECT name FROM warehouses WHERE org_id=?", [ORG])).map((x) => String(x.name).trim().toLowerCase()));
  return new Set((await q("SELECT name FROM parties WHERE org_id=?", [ORG])).map((x) => String(x.name).trim().toLowerCase()));
};
const uomSet = async () => new Set((await q("SELECT code FROM uoms")).map((x) => String(x.code).toUpperCase()));

const validateItem = (p, seen, existing, uoms) => {
  if (!required(p,"sku")) return ["REQUIRED","SKU is required"];
  if (!/^[A-Za-z0-9._\/-]{1,40}$/.test(p.sku)) return ["SKU","SKU must be 1–40 letters, numbers, dot, underscore, slash or hyphen"];
  if (seen.has(p.sku.toLowerCase())) return ["DUP","Duplicate SKU within the file"];
  if (existing.has(p.sku.toLowerCase())) return ["EXISTS","SKU already exists in this organization"];
  if (!required(p,"name")) return ["REQUIRED","Item name is required"];
  if (!/^(\d{4}|\d{6}|\d{8})$/.test(p.hsn)) return ["HSN","HSN must be 4, 6 or 8 digits"];
  if (!validNumber(p.gst_rate) || Number(p.gst_rate) < 0 || Number(p.gst_rate) > 100) return ["GST","GST rate must be between 0 and 100"];
  if (!uoms.has(String(p.base_uom).toUpperCase())) return ["UOM","Base UOM does not exist"];
  if (p.batch_tracked && !["1","0","true","false","yes","no","y"].includes(p.batch_tracked.toLowerCase())) return ["BOOL","batch_tracked must be true/false or 1/0"];
  if (p.valuation && !["FIFO","WAVG"].includes(p.valuation.toUpperCase())) return ["VALUATION","Valuation must be FIFO or WAVG"];
  seen.add(p.sku.toLowerCase());
  return null;
};

const validateWarehouse = (p, seen, existing, uoms) => {
  const name = required(p,"name");
  if (!name) return ["REQUIRED","Warehouse name is required"];
  if (name.length > 100) return ["LENGTH","Warehouse name must be 100 characters or fewer"];
  const key = name.toLowerCase();
  if (seen.has(key)) return ["DUP","Duplicate warehouse name within the file"];
  if (existing.has(key)) return ["EXISTS","Warehouse name already exists in this organization"];
  if (p.allow_negative && !["1","0","true","false","yes","no","y"].includes(p.allow_negative.toLowerCase())) return ["BOOL","allow_negative must be true/false or 1/0"];
  if (p.default_uom && !uoms.has(p.default_uom.toUpperCase())) return ["UOM","Default UOM does not exist"];
  if (p.default_reorder && (!validNumber(p.default_reorder) || Number(p.default_reorder) < 0)) return ["NUMBER","default_reorder must be zero or greater"];
  if (p.max_stock && (!validNumber(p.max_stock) || Number(p.max_stock) < 0)) return ["NUMBER","max_stock must be zero or greater"];
  if (p.max_stock && p.default_reorder && Number(p.max_stock) < Number(p.default_reorder)) return ["RANGE","max_stock cannot be less than default_reorder"];
  seen.add(key);
  return null;
};

const gstin = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const validateParty = (p, seen, existing) => {
  const name = required(p,"name");
  if (!name) return ["REQUIRED","Party name is required"];
  if (name.length > 150) return ["LENGTH","Party name must be 150 characters or fewer"];
  const key = name.toLowerCase();
  if (seen.has(key)) return ["DUP","Duplicate party name within the file"];
  if (existing.has(key)) return ["EXISTS","Party name already exists in this organization"];
  if (!["CUSTOMER","SUPPLIER"].includes(String(p.party_type || "CUSTOMER").toUpperCase())) return ["TYPE","party_type must be CUSTOMER or SUPPLIER"];
  if (p.gstin && !gstin.test(p.gstin.toUpperCase())) return ["GSTIN","GSTIN format is invalid"];
  if (p.mobile && !/^\d{10,15}$/.test(p.mobile)) return ["MOBILE","Mobile must contain 10–15 digits"];
  if (p.credit_limit && (!validNumber(p.credit_limit) || Number(p.credit_limit) < 0)) return ["NUMBER","credit_limit must be zero or greater"];
  if (p.status && !["ACTIVE","ON_HOLD","CREDIT_WATCH"].includes(p.status.toUpperCase())) return ["STATUS","status must be ACTIVE, ON_HOLD or CREDIT_WATCH"];
  if (p.preferred && !["1","0","true","false","yes","no","y"].includes(p.preferred.toLowerCase())) return ["BOOL","preferred must be true/false or 1/0"];
  seen.add(key);
  return null;
};

const validate = async (type, rows) => {
  const existing = await existingSets(type);
  const uoms = await uomSet();
  const seen = new Set();
  return rows.map((p, i) => {
    const bad = type === "ITEMS" ? validateItem(p, seen, existing, uoms) : type === "WAREHOUSES" ? validateWarehouse(p, seen, existing, uoms) : validateParty(p, seen, existing);
    return [i + 1, JSON.stringify(p), bad?.[0] || null, bad?.[1] || null];
  });
};

const summary = async (id) => {
  const [job] = await q("SELECT * FROM import_jobs WHERE id=? AND org_id=?", [id, ORG]);
  if (!job || !TYPES[job.import_type]) return null;
  const [counts] = await q("SELECT COUNT(*) total,SUM(error_kind IS NULL) valid,SUM(error_kind IS NOT NULL) errors,SUM(fixed) fixed,SUM(error_kind IS NOT NULL AND fixed=0) remaining FROM import_rows WHERE job_id=?", [id]);
  const kinds = await q("SELECT error_kind kind,COUNT(*) rows FROM import_rows WHERE job_id=? AND error_kind IS NOT NULL GROUP BY error_kind ORDER BY rows DESC", [id]);
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

r.post("/imports", express.text({ type: "text/csv", limit: "20mb" }), async (req, res, next) => {
  const type = normalizeType(req.query.type);
  if (!TYPES[type]) return next();
  const data = normalizeRows(type, parseCsv(String(req.body || "")));
  if (!data.length) return res.status(422).json({ error: "CSV contains no data rows" });
  const headerError = validateHeaders(type, data);
  if (headerError) return res.status(422).json({ error: headerError });
  const vals = await validate(type, data);
  const [job] = await q("INSERT INTO import_jobs (org_id,filename,import_type,status,rows_total) VALUES (?,?,?,'VALIDATED',?)", [ORG, req.query.filename || `${type.toLowerCase()}.csv`, type, data.length]);
  for (let i = 0; i < vals.length; i += 500) await q("INSERT INTO import_rows (job_id,row_no,payload,error_kind,error_msg) VALUES ?", [vals.slice(i, i + 500).map((x) => [job.insertId, ...x])]);
  res.status(201).json(await summary(job.insertId));
});

r.get("/imports/:id", async (req, res, next) => {
  if (!await loadTypedJob(req.params.id)) return next();
  res.json(await summary(req.params.id));
});

r.get("/imports/:id/rows", async (req, res, next) => {
  if (!await loadTypedJob(req.params.id)) return next();
  const only = req.query.errorsOnly !== "0";
  res.json(await q(`SELECT row_no,payload,error_kind,error_msg,fixed FROM import_rows WHERE job_id=? ${only ? "AND error_kind IS NOT NULL AND fixed=0" : ""} ORDER BY row_no LIMIT 100 OFFSET ?`, [req.params.id, Math.max(0, Number(req.query.cursor || 0))]));
});

r.patch("/imports/:id/rows/:no", async (req, res, next) => {
  const job = await loadTypedJob(req.params.id);
  if (!job) return next();
  const [row] = await q("SELECT payload FROM import_rows WHERE job_id=? AND row_no=?", [req.params.id, req.params.no]);
  if (!row) return res.status(404).json({ error: "Row not found" });
  const p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  if (!req.body?.field || !Object.prototype.hasOwnProperty.call(p, req.body.field)) return res.status(422).json({ error: "Invalid import field" });
  p[req.body.field] = String(req.body.value ?? "").trim();
  const [one] = await validate(job.import_type, [p]);
  if (one[2]) return res.status(422).json({ error: one[3] });
  await q("UPDATE import_rows SET payload=?,error_kind=NULL,error_msg=NULL,fixed=1 WHERE job_id=? AND row_no=?", [JSON.stringify(p), req.params.id, req.params.no]);
  res.json(await summary(req.params.id));
});

r.post("/imports/:id/cancel", async (req, res, next) => {
  if (!await loadTypedJob(req.params.id)) return next();
  await q("UPDATE import_jobs SET status='CANCELLED' WHERE id=? AND org_id=? AND status='VALIDATED'", [req.params.id, ORG]);
  res.json(await summary(req.params.id));
});

r.post("/imports/:id/commit", async (req, res, next) => {
  const job = await loadTypedJob(req.params.id);
  if (!job) return next();
  const [j] = await q("SELECT status FROM import_jobs WHERE id=? AND org_id=?", [req.params.id, ORG]);
  if (j?.status !== "VALIDATED") return res.status(409).json({ error: "Commit is only allowed from the VALIDATED state" });
  const rows = await q("SELECT row_no,payload FROM import_rows WHERE job_id=? AND (error_kind IS NULL OR fixed=1) ORDER BY row_no", [req.params.id]);
  const c = await pool.getConnection();
  let posted = 0;
  try {
    await c.beginTransaction();
    for (const x of rows) {
      const p = typeof x.payload === "string" ? JSON.parse(x.payload) : x.payload;
      if (job.import_type === "ITEMS") {
        await c.query("INSERT INTO items (org_id,sku,name,brand,category,hsn,gst_rate,base_uom,batch_tracked,valuation) VALUES (?,?,?,?,?,?,?,?,?,?)", [ORG,p.sku,p.name,p.brand||null,p.category||null,p.hsn,Number(p.gst_rate),String(p.base_uom).toUpperCase(),asBool(p.batch_tracked),p.valuation ? p.valuation.toUpperCase() : "FIFO"]);
      } else if (job.import_type === "WAREHOUSES") {
        await c.query("INSERT INTO warehouses (org_id,name,notes,allow_negative,default_uom,default_reorder,max_stock) VALUES (?,?,?,?,?,?,?)", [ORG,p.name,p.notes||null,asBool(p.allow_negative),String(p.default_uom||"NOS").toUpperCase(),Number(p.default_reorder||0),p.max_stock === "" ? null : Number(p.max_stock)]);
      } else {
        await c.query("INSERT INTO parties (org_id,name,gstin,mobile,credit_limit,terms,party_type,status,preferred) VALUES (?,?,?,?,?,?,?,?,?)", [ORG,p.name,p.gstin ? p.gstin.toUpperCase() : null,p.mobile||null,Number(p.credit_limit||0),p.terms||"Net 30",String(p.party_type||"CUSTOMER").toUpperCase(),String(p.status||"ACTIVE").toUpperCase(),asBool(p.preferred)]);
      }
      posted++;
    }
    await c.query("UPDATE import_jobs SET status='COMMITTED',rows_valid=?,rows_error=? WHERE id=? AND org_id=?", [posted, rows.length === posted ? 0 : rows.length - posted, req.params.id, ORG]);
    await c.commit();
    res.json({ ok:true, posted, type:job.import_type });
  } catch (e) {
    await c.rollback();
    res.status(e.code === "ER_DUP_ENTRY" ? 409 : 500).json({ error: e.code === "ER_DUP_ENTRY" ? "A row conflicts with an existing master record" : e.message, posted:0 });
  } finally { c.release(); }
});

export default r;
