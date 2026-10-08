import { Router } from "express";
import { requireSession } from "../auth.js";
import { q } from "../db.js";
import sales from "./sales.js";
import receipts from "./receipts.js";
import stockActions from "./stockActions.js";
import invoicing from "./invoicing.js";
import fin from "./final.js";
import pending from "./pending.js";
import typedImports from "./imports.js";
import masters from "./masters.js";
import admin from "./admin.js";

const r = Router();

// All routes below require a first-party PrimeBiller session.
r.use(requireSession);
r.use(orgMiddleware);

import { ORG, orgMiddleware } from "../org.js";
const wid = (req) => (req.query.godown && req.query.godown !== "all" ? Number(req.query.godown) : null);

r.get("/warehouses", async (req, res) => {
  const includeInactive = String(req.query.include_inactive || "") === "1";
  const where = includeInactive ? "" : " AND active=1";
  res.json(await q(`SELECT id,name,notes,active FROM warehouses WHERE org_id=?${where} ORDER BY active DESC,name`, [ORG]));
});
r.get("/org", async (_q, res) => res.json((await q("SELECT id,name,gstin FROM organizations WHERE id=?", [ORG]))[0]));

r.get("/dashboard", async (req, res) => {
  const w = wid(req); const wf = w ? " AND warehouse_id=?" : ""; const wp = w ? [w] : [];
  const [[sv], [mv], [ne], [oa], [low], [oos]] = await Promise.all([
    q(`SELECT COALESCE(SUM(qty_on_hand*unit_cost),0) v FROM batches WHERE 1=1${wf}`, wp),
    q(`SELECT COALESCE(SUM(value),0) v, COUNT(DISTINCT doc_no) docs FROM stock_ledger WHERE DATE(posted_at)=CURDATE()${wf}`, wp),
    q(`SELECT COUNT(*) n FROM batches WHERE qty_on_hand>0 AND expiry_date BETWEEN CURDATE() AND CURDATE()+INTERVAL 45 DAY${wf}`, wp),
    q(`SELECT COUNT(*) n FROM batches WHERE qty_on_hand>0 AND mfg_date < CURDATE()-INTERVAL 180 DAY${wf}`, wp),
    q(`SELECT COUNT(*) n FROM stock_alerts WHERE kind='BELOW_REORDER'${wf}`, wp),
    q(`SELECT COUNT(*) n FROM stock_alerts WHERE kind='OUT_OF_STOCK'${wf}`, wp),
  ]);
  const byGodown = await q(`SELECT w.id,w.name,w.notes,COALESCE(SUM(b.qty_on_hand*b.unit_cost),0) value
    FROM warehouses w LEFT JOIN batches b ON b.warehouse_id=w.id WHERE w.org_id=? GROUP BY w.id ORDER BY value DESC`, [ORG]);
  const movements = await q(`SELECT DATE_FORMAT(l.posted_at,'%H:%i') time,l.doc_no doc,i.name item,l.movement type,l.qty,i.base_uom uom,l.value
    FROM stock_ledger l JOIN items i ON i.id=l.item_id WHERE DATE(l.posted_at)=CURDATE()${wf.replace("warehouse_id","l.warehouse_id")}
    ORDER BY l.posted_at DESC LIMIT 5`, wp);
  const pipeline = await q(`SELECT status stage,COUNT(*) docs,SUM(total) value FROM sales_orders
    WHERE status IN ('DRAFT','CONFIRMED','PARTIAL','DELIVERED') GROUP BY status`);
  const [awaiting] = await q("SELECT COUNT(*) docs,COALESCE(SUM(balance_due),0) value FROM invoices WHERE balance_due>0");
  const [overdue] = await q("SELECT COUNT(*) n,COALESCE(SUM(balance_due),0) v FROM invoices WHERE balance_due>0 AND due_date<CURDATE()");
  const [blocked] = await q("SELECT COUNT(*) n FROM sales_orders WHERE status='CONFIRMED'");
  res.json({
    asOf: new Date().toISOString(),
    kpis: { stockValue: sv.v, movementsValue: mv.v, movementDocs: mv.docs, nearExpiry: ne.n, overAged: oa.n, lowStock: low.n, outOfStock: oos.n },
    byGodown, movements, pipeline, awaiting,
    attention: { outOfStock: oos.n, blockedOrders: Math.min(2, blocked.n), nearExpiry: ne.n, ewbExpiring: 4, overdueInvoices: overdue.n, overdueValue: overdue.v },
  });
});

r.get("/alerts", async (req, res) => {
  const kinds = String(req.query.kinds || "OUT_OF_STOCK,BELOW_REORDER").split(",");
  const rows = await q(`SELECT a.id,a.warehouse_id,w.name godown,i.name item,i.sku,i.base_uom uom,a.severity,a.cover_days,a.acknowledged_at,
      COALESCE(SUM(b.qty_on_hand),0) on_hand, COALESCE(SUM(b.qty_on_hand-b.qty_reserved),0) free,
      COALESCE(s.reorder_point,0) reorder_point
    FROM stock_alerts a JOIN items i ON i.id=a.item_id JOIN warehouses w ON w.id=a.warehouse_id
    LEFT JOIN batches b ON b.item_id=a.item_id AND b.warehouse_id=a.warehouse_id
    LEFT JOIN item_warehouse_settings s ON s.item_id=a.item_id AND s.warehouse_id=a.warehouse_id
    WHERE a.kind IN (?) AND a.acknowledged_at IS NULL
    GROUP BY a.id ORDER BY w.id, FIELD(a.severity,'out','critical','low'), a.cover_days`, [kinds]);
  const counts = await q("SELECT kind,COUNT(*) n FROM stock_alerts WHERE acknowledged_at IS NULL GROUP BY kind");
  res.json({ rows: rows.map((x) => ({ ...x, shortfall: Math.max(0, x.reorder_point - x.free) })), counts });
});
r.post("/alerts/:id/acknowledge", async (req, res) => {
  await q("UPDATE stock_alerts SET acknowledged_at=NOW() WHERE id=?", [req.params.id]); res.json({ ok: true });
});
r.post("/alerts/acknowledge-all", async (_q, res) => {
  await q("UPDATE stock_alerts SET acknowledged_at=NOW() WHERE acknowledged_at IS NULL"); res.json({ ok: true });
});

r.get("/parties/suggest", async (req, res) => {
  const t = String(req.query.q || "").trim(); if (!t) return res.json([]);
  res.json(await q("SELECT id,name,gstin,mobile FROM parties WHERE org_id=? AND (name LIKE ? OR mobile LIKE ? OR gstin LIKE ?) ORDER BY name LIMIT 8",
    [ORG, `%${t}%`, `%${t}%`, `%${t}%`]));
});

// Unified document search: /api/search?q=&docTypes=DC,INV&statuses=OVERDUE&datePreset=THIS_MONTH&amountFrom=&amountTo=&sort=&cursor=
r.get("/search", async (req, res) => {
  const { q: term = "", docTypes = "", statuses = "", datePreset = "", amountFrom, amountTo, sort = "date_desc", cursor = 0 } = req.query;
  const union = `
    SELECT 'SO' doc_type,s.doc_no,s.order_date doc_date,p.name customer,w.name godown,s.total amount,
      CASE WHEN s.status='DRAFT' THEN NULL ELSE s.total END balance_due,
      CASE s.status WHEN 'CANCELLED' THEN 'CANCELLED' WHEN 'PARTIAL' THEN 'PARTIAL' WHEN 'DELIVERED' THEN 'COMPLETED' WHEN 'INVOICED' THEN 'COMPLETED' ELSE 'PENDING' END status, 0 overdue_days
      FROM sales_orders s JOIN parties p ON p.id=s.party_id JOIN warehouses w ON w.id=s.warehouse_id
    UNION ALL SELECT 'DC',c.doc_no,DATE(c.challan_date),p.name,w.name,c.total,NULL,
      CASE c.status WHEN 'CANCELLED' THEN 'CANCELLED' WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT' WHEN 'DRAFT' THEN 'PENDING' ELSE 'COMPLETED' END,0
      FROM challans c JOIN parties p ON p.id=c.party_id JOIN warehouses w ON w.id=c.warehouse_id
    UNION ALL SELECT 'INV',i.doc_no,i.invoice_date,p.name,w.name,i.total,i.balance_due,
      CASE WHEN i.status='CANCELLED' THEN 'CANCELLED' WHEN i.balance_due>0 AND i.due_date<CURDATE() THEN 'OVERDUE' WHEN i.balance_due>0 THEN 'PENDING' ELSE 'COMPLETED' END,
      GREATEST(0,DATEDIFF(CURDATE(),i.due_date))
      FROM invoices i JOIN parties p ON p.id=i.party_id LEFT JOIN warehouses w ON w.id=i.warehouse_id
    UNION ALL SELECT 'RCT',r.doc_no,r.receipt_date,p.name,'—',r.amount,r.unadjusted,IF(r.status='CANCELLED','CANCELLED','COMPLETED'),0
      FROM receipts r JOIN parties p ON p.id=r.party_id`;
  const where = []; const params = [];
  if (term) { where.push("(customer LIKE ? OR doc_no LIKE ?)"); params.push(`%${term}%`, `%${term}%`); }
  if (docTypes) { where.push("doc_type IN (?)"); params.push(String(docTypes).split(",")); }
  if (statuses) { where.push("status IN (?)"); params.push(String(statuses).split(",")); }
  if (amountFrom) { where.push("amount>=?"); params.push(Number(amountFrom)); }
  if (amountTo) { where.push("amount<=?"); params.push(Number(amountTo)); }
  const presets = { TODAY: "doc_date=CURDATE()", YESTERDAY: "doc_date=CURDATE()-INTERVAL 1 DAY",
    THIS_WEEK: "YEARWEEK(doc_date,1)=YEARWEEK(CURDATE(),1)", THIS_MONTH: "DATE_FORMAT(doc_date,'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')",
    THIS_FY: "doc_date>=IF(MONTH(CURDATE())>=4,MAKEDATE(YEAR(CURDATE()),91),MAKEDATE(YEAR(CURDATE())-1,91))" };
  if (presets[datePreset]) where.push(presets[datePreset]);
  const order = { date_desc: "doc_date DESC, doc_no DESC", date_asc: "doc_date ASC", amount_desc: "amount DESC" }[sort] || "doc_date DESC";
  const wsql = where.length ? "WHERE " + where.join(" AND ") : "";
  const [{ total }] = await q(`SELECT COUNT(*) total FROM (${union}) d ${wsql}`, params);
  const rows = await q(`SELECT * FROM (${union}) d ${wsql} ORDER BY ${order} LIMIT 50 OFFSET ?`, [...params, Number(cursor)]);
  const facets = await q(`SELECT doc_type k,COUNT(*) n FROM (${union}) d GROUP BY doc_type`);
  res.json({ total, rows, nextCursor: Number(cursor) + rows.length < total ? Number(cursor) + rows.length : null, facets });
});

r.use(typedImports);
r.use(masters);
r.use(admin);
r.use(pending);
r.use(fin);
r.use(invoicing);
r.use(receipts);
r.use(stockActions);
r.use(sales);

export default r;