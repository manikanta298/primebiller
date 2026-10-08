import { Router } from "express";
import { pool, q } from "../db.js";
import { ORG } from "../org.js";

const r = Router();

const activeWarehouse = async (id) => {
  const [[w]] = await q("SELECT id,active FROM warehouses WHERE id=? AND org_id=?", [id, ORG]);
  return w;
};

r.get("/warehouses/list", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const where = ["w.org_id=?"]; const params = [ORG];
  if (search) { const like = `%${search}%`; where.push("(w.name LIKE ? OR w.notes LIKE ?)"); params.push(like, like); }
  const [rows] = await q(`SELECT w.id,w.name,w.notes,w.allow_negative,w.default_uom,w.default_reorder,w.max_stock,w.active_skus,
      w.active,COALESCE(SUM(b.qty_on_hand*b.unit_cost),0) stock_value,
      COUNT(DISTINCT CASE WHEN b.qty_on_hand-b.qty_reserved>0 THEN b.item_id END) live_skus,
      (SELECT COUNT(*) FROM stock_alerts a WHERE a.warehouse_id=w.id AND a.acknowledged_at IS NULL) alerts
    FROM warehouses w LEFT JOIN batches b ON b.warehouse_id=w.id
    WHERE ${where.join(" AND ")} GROUP BY w.id ORDER BY w.active DESC,w.name`, params);
  res.json({ rows });
});

r.get("/warehouses/:id/dashboard", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(422).json({ error: "Invalid godown id" });
  const [[warehouse]] = await q("SELECT id,name,notes,active,allow_negative,default_uom,default_reorder,max_stock FROM warehouses WHERE id=? AND org_id=?", [id, ORG]);
  if (!warehouse) return res.status(404).json({ error: "Godown not found" });
  const [[summary]] = await q(`SELECT COALESCE(SUM(b.qty_on_hand*b.unit_cost),0) stock_value,
      COALESCE(SUM(b.qty_on_hand),0) on_hand,COALESCE(SUM(b.qty_reserved),0) reserved,
      COUNT(DISTINCT CASE WHEN b.qty_on_hand-b.qty_reserved>0 THEN b.item_id END) live_skus,
      COUNT(DISTINCT CASE WHEN b.qty_on_hand-b.qty_reserved<=0 THEN b.item_id END) zero_skus,
      COUNT(DISTINCT b.item_id) tracked_skus FROM batches b WHERE b.warehouse_id=?`, [id]);
  const [movements] = await q(`SELECT DATE_FORMAT(l.posted_at,'%H:%i') time,l.doc_no doc,l.movement type,
      i.name item,i.sku,i.base_uom uom,l.qty,l.value,l.posted_at
    FROM stock_ledger l JOIN items i ON i.id=l.item_id WHERE l.org_id=? AND l.warehouse_id=?
    ORDER BY l.posted_at DESC,l.id DESC LIMIT 8`, [ORG,id]);
  const [stock] = await q(`SELECT i.id item_id,i.sku,i.name,i.base_uom,COALESCE(SUM(b.qty_on_hand),0) on_hand,
      COALESCE(SUM(b.qty_reserved),0) reserved,COALESCE(SUM((b.qty_on_hand-b.qty_reserved)*b.unit_cost),0) stock_value,
      COALESCE(s.reorder_point,w.default_reorder,0) reorder_point,COALESCE(s.max_qty,w.max_stock) max_qty,
      CASE WHEN COALESCE(SUM(b.qty_on_hand-b.qty_reserved),0)<=0 THEN 'ZERO'
           WHEN COALESCE(SUM(b.qty_on_hand-b.qty_reserved),0)<COALESCE(s.reorder_point,w.default_reorder,0) THEN 'LOW' ELSE 'OK' END stock_status
    FROM items i JOIN warehouses w ON w.id=? AND w.org_id=i.org_id
    LEFT JOIN item_warehouse_settings s ON s.item_id=i.id AND s.warehouse_id=w.id
    LEFT JOIN batches b ON b.item_id=i.id AND b.warehouse_id=w.id WHERE i.org_id=?
    GROUP BY i.id,i.sku,i.name,i.base_uom,s.reorder_point,s.max_qty,w.default_reorder,w.max_stock
    ORDER BY CASE stock_status WHEN 'ZERO' THEN 0 WHEN 'LOW' THEN 1 ELSE 2 END,i.name`, [id,ORG]);
  const alerts = await q(`SELECT a.id,a.kind,a.severity,i.name item,i.sku,
      COALESCE(SUM(b.qty_on_hand-b.qty_reserved),0) free,COALESCE(s.reorder_point,w.default_reorder,0) reorder_point
    FROM stock_alerts a JOIN items i ON i.id=a.item_id JOIN warehouses w ON w.id=a.warehouse_id
    LEFT JOIN batches b ON b.item_id=a.item_id AND b.warehouse_id=a.warehouse_id
    LEFT JOIN item_warehouse_settings s ON s.item_id=a.item_id AND s.warehouse_id=a.warehouse_id
    WHERE a.warehouse_id=? AND a.acknowledged_at IS NULL AND a.kind IN ('OUT_OF_STOCK','BELOW_REORDER')
    GROUP BY a.id ORDER BY FIELD(a.severity,'out','critical','low'),i.name LIMIT 12`, [id]);
  const [[today]] = await q(`SELECT COALESCE(SUM(ABS(value)),0) movement_value,COUNT(DISTINCT doc_no) movement_docs
    FROM stock_ledger WHERE org_id=? AND warehouse_id=? AND posted_at>=CURDATE()`, [ORG,id]);
  const liveSkus = stock.filter((x) => Number(x.on_hand) - Number(x.reserved) > 0).length;
  const zeroSkus = stock.length - liveSkus;
  res.json({ warehouse, kpis: { ...summary, ...today, tracked_skus: stock.length, live_skus: liveSkus, zero_skus: zeroSkus }, stock, movements, alerts });
});

r.patch("/warehouses/:id/status", async (req, res) => {
  const id = Number(req.params.id); const active = req.body?.active;
  if (!Number.isInteger(id) || id < 1 || typeof active !== "boolean") return res.status(422).json({ error: "Valid id and boolean active are required" });
  const [used] = await q("SELECT COUNT(*) n FROM stock_transfers WHERE org_id=? AND status='IN_TRANSIT' AND (from_warehouse_id=? OR to_warehouse_id=?)", [ORG,id,id]);
  if (!active && Number(used[0]?.n || 0) > 0) return res.status(409).json({ error: "Cannot deactivate a godown with stock transfers still in transit" });
  const [result] = await q("UPDATE warehouses SET active=? WHERE id=? AND org_id=?", [active ? 1 : 0,id,ORG]);
  if (!result.affectedRows) return res.status(404).json({ error: "Godown not found" });
  res.json({ ok:true, active });
});

r.get("/ledger", async (req, res) => {
  const item = String(req.query.item || "").trim();
  const godown = req.query.godown && req.query.godown !== "all" ? Number(req.query.godown) : null;
  const type = String(req.query.type || "").trim().toUpperCase();
  const where = ["l.org_id=?"]; const params = [ORG];
  if (item) { where.push("(i.name LIKE ? OR i.sku LIKE ? OR b.batch_no LIKE ?)"); params.push(`%${item}%`,`%${item}%`,`%${item}%`); }
  if (godown) { where.push("l.warehouse_id=?"); params.push(godown); }
  if (type) { where.push("l.movement=?"); params.push(type); }
  const [rows] = await q(`SELECT l.id,l.posted_at,l.doc_no,l.movement,l.qty,l.value,l.reason,
      i.name item,i.sku,b.batch_no,w.name godown,i.base_uom uom,
      ROUND(SUM(l.qty) OVER (PARTITION BY l.warehouse_id,l.item_id ORDER BY l.posted_at,l.id ROWS UNBOUNDED PRECEDING),3) balance_qty
    FROM stock_ledger l JOIN items i ON i.id=l.item_id LEFT JOIN batches b ON b.id=l.batch_id JOIN warehouses w ON w.id=l.warehouse_id
    WHERE ${where.join(" AND ")} ORDER BY l.posted_at DESC,l.id DESC LIMIT 100`, params);
  const suffix = godown ? " AND warehouse_id=?" : ""; const kp = godown ? [ORG,godown] : [ORG];
  const [[opening]] = await q(`SELECT COALESCE(SUM(qty_on_hand*unit_cost),0) value FROM batches${godown ? " WHERE warehouse_id=?" : ""}`, godown ? [godown] : []);
  const [[inwards]] = await q(`SELECT COALESCE(SUM(value),0) value,COALESCE(SUM(ABS(qty)),0) qty FROM stock_ledger WHERE org_id=? AND posted_at>=CURDATE() AND movement='PURCHASE'${suffix}`, kp);
  const [[outwards]] = await q(`SELECT COALESCE(SUM(value),0) value,COUNT(*) docs FROM stock_ledger WHERE org_id=? AND posted_at>=CURDATE() AND movement IN ('DC_ISSUE','TRANSFER_OUT')${suffix}`, kp);
  const [[documents]] = await q(`SELECT COUNT(*) n FROM stock_ledger WHERE org_id=? AND posted_at>=CURDATE()${suffix}`, kp);
  const counts = await q(`SELECT movement type,COUNT(*) n FROM stock_ledger WHERE org_id=? AND posted_at>=CURDATE()${suffix} GROUP BY movement`, kp);
  res.json({ rows, summary:{opening,inwards,outwards,documents:documents.n}, counts });
});

r.use(async (req, res, next) => {
  const path = req.path;
  try {
    if (req.method === "POST" && path === "/transfers") {
      const from = await activeWarehouse(Number(req.body?.fromWarehouseId));
      const to = await activeWarehouse(Number(req.body?.toWarehouseId));
      if (!from || !to) return res.status(422).json({ error: "Invalid source or destination godown" });
      if (!from.active || !to.active) return res.status(422).json({ error: "Transfers are blocked for inactive godowns" });
    } else if (req.method === "POST" && path.match(/^\/transfers\/\d+\/(issue|receive)$/)) {
      const [[t]] = await q("SELECT from_warehouse_id,to_warehouse_id FROM stock_transfers WHERE id=? AND org_id=?", [Number(path.split('/')[2]),ORG]);
      if (t) { const from = await activeWarehouse(t.from_warehouse_id); const to = await activeWarehouse(t.to_warehouse_id); if (!from?.active || !to?.active) return res.status(409).json({ error: "Stock transfer operation is blocked because a godown is inactive" }); }
    } else if (req.method === "POST" && path === "/adjustments") {
      const w = await activeWarehouse(Number(req.body?.warehouseId));
      if (!w) return res.status(422).json({ error: "Invalid godown" });
      if (!w.active) return res.status(422).json({ error: "Stock adjustments are blocked for inactive godowns" });
    } else if (req.method === "POST" && path.match(/^\/adjustments\/\d+\/approve$/)) {
      const [[a]] = await q("SELECT warehouse_id FROM stock_adjustments WHERE id=? AND org_id=?", [Number(path.split('/')[2]),ORG]);
      if (a) { const w = await activeWarehouse(a.warehouse_id); if (!w?.active) return res.status(409).json({ error: "Stock adjustment approval is blocked because the godown is inactive" }); }
    }
    next();
  } catch (e) { next(e); }
});

export default r;