import { Router } from "express";
import { q } from "../db.js";
import { ORG } from "../org.js";

const r = Router();

// Batch picker for the stock forms: batches with free stock in one godown (free = on hand - reserved for orders).
r.get("/stock/batches", async (req, res) => {
  const wh = Number(req.query.warehouse_id);
  if (!Number.isInteger(wh) || wh < 1) return res.status(422).json({ error: "warehouse_id is required" });
  const term = String(req.query.search || "").trim().replace(/[\\%_]/g, "\\$&");
  const where = ["w.org_id=?", "b.warehouse_id=?"], params = [ORG, wh];
  if (term) { where.push("(i.name LIKE ? OR i.sku LIKE ? OR b.batch_no LIKE ?)"); params.push(`%${term}%`, `%${term}%`, `%${term}%`); }
  if (req.query.in_stock === "1") where.push("b.qty_on_hand>b.qty_reserved");
  res.json({ rows: await q(`SELECT b.id batch_id,b.item_id,i.name item,i.sku,b.batch_no,b.expiry_date,b.unit_cost,b.qty_on_hand,b.qty_reserved,
      b.qty_on_hand-b.qty_reserved free FROM batches b JOIN items i ON i.id=b.item_id JOIN warehouses w ON w.id=b.warehouse_id
    WHERE ${where.join(" AND ")} AND w.active=1 ORDER BY i.name,b.mfg_date,b.id LIMIT 100`, params) });
});

export default r;