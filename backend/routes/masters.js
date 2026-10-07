import { Router } from "express";
import { pool, q } from "../db.js";
import { ORG } from "../org.js";
import { TYPES, cleanRow, validate, insertMaster, updateMaster, masterExists } from "./imports.js";

const r = Router();
const PATHS = { items: "ITEMS", warehouses: "WAREHOUSES", parties: "PARTIES" };

// Units of measure for form dropdowns.
r.get("/uoms", async (_req, res) => {
  res.json({ rows: await q("SELECT code,category FROM uoms ORDER BY code") });
});

// Single-entry create: same validation and insert path as the bulk importer.
for (const [path, type] of Object.entries(PATHS)) {
  r.post(`/${path}`, async (req, res) => {
    const body = cleanRow(req.body || {});
    const row = Object.fromEntries(TYPES[type].columns.filter((c) => c in body).map((c) => [c, body[c]]));
    const [checked] = await validate(type, [row]);
    if (checked[2]) return res.status(422).json({ error: checked[3], kind: checked[2], field: checked[4] });

    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      if (await masterExists(c, type, row)) {
        await c.rollback();
        const field = type === "ITEMS" ? "sku" : "name";
        return res.status(409).json({ error: `${TYPES[type].label.replace(/s$/, "")} with this ${field} already exists`, kind: "EXISTS", field });
      }
      const id = await insertMaster(c, type, row);
      await c.commit();
      res.status(201).json({ ok: true, id });
    } catch (e) {
      await c.rollback().catch(() => {});
      if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "A record with this key already exists", kind: "EXISTS" });
      throw e;
    } finally {
      c.release();
    }
  });
}

// ---------- Delete (single and bulk) ----------
// A record that is referenced by stock, orders, invoices etc. is never removed: MySQL's foreign keys
// refuse it and we report why, so history stays intact. Pure configuration rows (unit conversions,
// per-godown settings, derived stock alerts) are removed together with their parent.
const TABLE = { ITEMS: "items", WAREHOUSES: "warehouses", PARTIES: "parties" };
const LABEL = { ITEMS: "Item", WAREHOUSES: "Godown", PARTIES: "Party" };
const CHILDREN = {
  ITEMS: ["DELETE FROM item_uoms WHERE item_id=?", "DELETE FROM item_warehouse_settings WHERE item_id=?", "DELETE FROM stock_alerts WHERE item_id=?"],
  WAREHOUSES: ["DELETE FROM item_warehouse_settings WHERE warehouse_id=?", "DELETE FROM stock_alerts WHERE warehouse_id=?"],
  PARTIES: [],
};
const MAX_BULK_DELETE = 500;

// Each record is deleted in its own transaction, so one blocked record never stops the others.
export async function deleteMaster(type, id) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[row]] = await c.query(`SELECT id,${type === "ITEMS" ? "sku" : "name"} AS label FROM ${TABLE[type]} WHERE id=? AND org_id=? FOR UPDATE`, [id, ORG]);
    if (!row) { await c.rollback(); return { id, ok: false, reason: `${LABEL[type]} not found` }; }
    for (const sql of CHILDREN[type]) await c.query(sql, [id]);
    await c.query(`DELETE FROM ${TABLE[type]} WHERE id=? AND org_id=?`, [id, ORG]);
    await c.commit();
    return { id, ok: true, label: row.label };
  } catch (e) {
    await c.rollback().catch(() => {});
    if (e.errno === 1451 || e.code === "ER_ROW_IS_REFERENCED_2") return { id, ok: false, reason: `${LABEL[type]} is used in stock or transactions and cannot be deleted` };
    throw e;
  } finally {
    c.release();
  }
}

for (const [path, type] of Object.entries(PATHS)) {
  // Bulk first so "bulk-delete" is never read as an :id.
  r.post(`/${path}/bulk-delete`, async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number))];
    if (!ids.length || ids.some((n) => !Number.isInteger(n) || n < 1)) return res.status(422).json({ error: "Select at least one record to delete" });
    if (ids.length > MAX_BULK_DELETE) return res.status(422).json({ error: `Select at most ${MAX_BULK_DELETE} records at a time` });
    const results = [];
    for (const id of ids) results.push(await deleteMaster(type, id));
    const deleted = results.filter((x) => x.ok).length;
    res.json({ ok: true, deleted, failed: results.length - deleted, results });
  });

  r.delete(`/${path}/:id`, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(422).json({ error: "Invalid id" });
    const out = await deleteMaster(type, id);
    if (out.ok) return res.json({ ok: true, deleted: 1 });
    res.status(out.reason.endsWith("not found") ? 404 : 409).json({ error: out.reason });
  });
}

// ---------- Read one / edit (Items and Parties; godowns are edited through PATCH /warehouses/:id) ----------
const EDITABLE = { items: "ITEMS", parties: "PARTIES" };
const LOCKED_ONCE_USED = ["base_uom", "batch_tracked", "valuation"]; // changing these under existing stock would corrupt it
const asForm = (type, row) => Object.fromEntries(TYPES[type].columns.map((c) => {
  const v = row[c];
  return [c, v == null ? "" : typeof v === "number" && ["batch_tracked", "preferred"].includes(c) ? String(Boolean(v)) : String(v)];
}));

for (const [path, type] of Object.entries(EDITABLE)) {
  r.get(`/${path}/:id`, async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next(); // leave /items/list, /items/search etc. to their own routes
    const [row] = await q(`SELECT * FROM ${TABLE[type]} WHERE id=? AND org_id=?`, [req.params.id, ORG]);
    if (!row) return res.status(404).json({ error: `${LABEL[type]} not found` });
    res.json(asForm(type, row));
  });

  r.patch(`/${path}/:id`, async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return next();
    const id = Number(req.params.id);
    const [cur] = await q(`SELECT * FROM ${TABLE[type]} WHERE id=? AND org_id=?`, [id, ORG]);
    if (!cur) return res.status(404).json({ error: `${LABEL[type]} not found` });
    const before = asForm(type, cur);
    const body = cleanRow(req.body || {}, type);
    const merged = { ...before, ...Object.fromEntries(TYPES[type].columns.filter((c) => c in body).map((c) => [c, body[c]])) };
    const [checked] = await validate(type, [merged], new Set(), id);
    if (checked[2]) return res.status(422).json({ error: checked[3], kind: checked[2], field: checked[4] });

    if (type === "ITEMS") {
      const changed = LOCKED_ONCE_USED.find((c) => String(merged[c]).toLowerCase() !== String(before[c]).toLowerCase());
      if (changed) {
        const [used] = await q("SELECT 1 FROM batches WHERE item_id=? UNION SELECT 1 FROM stock_ledger WHERE item_id=? LIMIT 1", [id, id]);
        if (used) return res.status(409).json({ error: `${changed} cannot be changed once the item has stock or movements`, kind: "LOCKED", field: changed });
      }
    }
    const c = await pool.getConnection();
    try {
      await updateMaster(c, type, id, merged);
      res.json({ ok: true });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "A record with this key already exists", kind: "EXISTS" });
      throw e;
    } finally { c.release(); }
  });
}

export default r;
