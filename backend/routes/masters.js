import { Router } from "express";
import { pool, q } from "../db.js";
import { TYPES, cleanRow, validate, insertMaster, masterExists } from "./imports.js";

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

export default r;
