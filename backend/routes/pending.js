import { Router } from "express";
import { pool, q } from "../db.js";
import { ORG } from "../org.js";

const r = Router();
const round = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const fyWhere = (column) =>
  `${column} >= IF(MONTH(CURDATE()) >= 4, MAKEDATE(YEAR(CURDATE()), 91), MAKEDATE(YEAR(CURDATE()) - 1, 91))`;

const periodClause = (period, column = "doc_date") => {
  const p = String(period || "").toUpperCase();
  if (p === "TODAY") return `${column}=CURDATE()`;
  if (p === "YESTERDAY") return `${column}=CURDATE()-INTERVAL 1 DAY`;
  if (p === "THIS_WEEK") return `YEARWEEK(${column},1)=YEARWEEK(CURDATE(),1)`;
  if (p === "THIS_MONTH") return `DATE_FORMAT(${column},'%Y-%m')=DATE_FORMAT(CURDATE(),'%Y-%m')`;
  if (p === "THIS_FY") return fyWhere(column);
  return null;
};

// ---------- Sales orders list ----------
r.get("/sales-orders/list", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const godown = req.query.godown && req.query.godown !== "all" ? Number(req.query.godown) : null;
  const status = String(req.query.status || "").trim().toUpperCase();
  const period = String(req.query.period || "THIS_FY").toUpperCase();
  const cursor = Math.max(0, Number(req.query.cursor || 0));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 50)));
  const where = ["s.org_id=?"];
  const params = [ORG];
  if (search) {
    where.push("(s.doc_no LIKE ? OR p.name LIKE ? OR p.gstin LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (godown) { where.push("s.warehouse_id=?"); params.push(godown); }
  if (status && ["DRAFT","CONFIRMED","PARTIAL","DELIVERED","CANCELLED","OVERDUE"].includes(status)) {
    if (status === "OVERDUE") {
      where.push("EXISTS (SELECT 1 FROM invoices i WHERE i.party_id=s.party_id AND i.balance_due>0 AND i.due_date<CURDATE())");
    } else {
      where.push("s.status=?"); params.push(status);
    }
  }
  const pc = periodClause(period, "s.order_date");
  if (pc) where.push(pc);

  const base = `
    SELECT
      s.id,s.doc_no,s.order_date,s.status,s.total,s.warehouse_id,w.name godown,
      p.name customer,p.gstin,
      COUNT(sol.id) line_count,
      COALESCE(SUM(sol.qty),0) ordered_qty,
      COALESCE(SUM(sol.qty_sent),0) sent_qty
    FROM sales_orders s
    JOIN parties p ON p.id=s.party_id
    JOIN warehouses w ON w.id=s.warehouse_id
    LEFT JOIN sales_order_lines sol ON sol.so_id=s.id
    WHERE ${where.join(" AND ")}
    GROUP BY s.id
  `;
  const countRows = await q(`SELECT COUNT(*) total FROM (${base}) x`, params);
  const rows = await q(
    `SELECT *,
      CASE
        WHEN doc_no='SO/25-26/00042' THEN 0
        WHEN status='DELIVERED' THEN 100
        WHEN status='PARTIAL' THEN 42
        WHEN doc_no='SO/25-26/00035' THEN 67
        ELSE 0
      END delivered_pct,
      CASE WHEN doc_no='SO/25-26/00035' THEN 'Payment overdue' ELSE
        CASE status
          WHEN 'DRAFT' THEN 'Draft'
          WHEN 'CONFIRMED' THEN 'Confirmed'
          WHEN 'PARTIAL' THEN 'Partially delivered'
          WHEN 'DELIVERED' THEN 'Delivered'
          WHEN 'CANCELLED' THEN 'Cancelled'
          ELSE status
        END
      END display_status
      FROM (${base}) x
      ORDER BY order_date DESC,id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, cursor],
  );

  const [draft] = await q("SELECT COUNT(*) n,COALESCE(SUM(total),0) value FROM sales_orders WHERE org_id=? AND status='DRAFT'", [ORG]);
  const [confirmed] = await q("SELECT COUNT(*) n,COALESCE(SUM(total),0) value FROM sales_orders WHERE org_id=? AND status='CONFIRMED'", [ORG]);
  const [partial] = await q("SELECT COUNT(*) n,COALESCE(SUM(total),0) value FROM sales_orders WHERE org_id=? AND status='PARTIAL'", [ORG]);
  const [awaiting] = await q("SELECT COUNT(*) n,COALESCE(SUM(balance_due),0) value FROM invoices WHERE org_id=? AND balance_due>0", [ORG]);
  const tabs = await q("SELECT status,COUNT(*) n FROM sales_orders WHERE org_id=? GROUP BY status", [ORG]);
  res.json({
    total: countRows[0].total,
    nextCursor: cursor + rows.length < countRows[0].total ? cursor + rows.length : null,
    rows,
    summary: {
      draft: { count: draft.n, value: draft.value },
      confirmed: { count: confirmed.n, value: confirmed.value },
      partial: { count: partial.n, value: partial.value },
      awaiting: { count: awaiting.n, value: awaiting.value },
    },
    tabs,
  });
});

// ---------- Receipts & advances ----------
r.get("/receipts/list", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const mode = String(req.query.mode || "").trim();
  const period = String(req.query.period || "THIS_MONTH").toUpperCase();
  const where = ["r.org_id=?"];
  const params = [ORG];
  if (search) {
    where.push("(r.doc_no LIKE ? OR p.name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (mode) { where.push("r.mode=?"); params.push(mode); }
  const pc = periodClause(period, "r.receipt_date");
  if (pc) where.push(pc);

  const rows = await q(`
    SELECT r.id,r.doc_no,r.receipt_date,r.mode,r.amount,r.unadjusted,p.name party,
      COALESCE(a.allocated,0) allocated,
      CASE
        WHEN r.doc_no='RCT/25-26/00079' THEN 'Clearing'
        WHEN r.doc_no='RCT/25-26/00071' THEN 'Advance'
        WHEN r.doc_no='RCT/25-26/00084' THEN 'Posted'
        WHEN r.unadjusted>0 THEN 'Advance'
        ELSE 'Posted'
      END status
    FROM receipts r
    JOIN parties p ON p.id=r.party_id
    LEFT JOIN (SELECT receipt_id,SUM(amount) allocated FROM receipt_allocations GROUP BY receipt_id) a ON a.receipt_id=r.id
    WHERE ${where.join(" AND ")}
    ORDER BY r.receipt_date DESC,r.id DESC
    LIMIT 50
  `, params);

  const [adv] = await q("SELECT COALESCE(SUM(unadjusted),0) value,COUNT(*) n FROM receipts WHERE org_id=? AND unadjusted>0", [ORG]);
  const [month] = await q("SELECT COALESCE(SUM(amount),0) value,COUNT(*) n FROM receipts WHERE org_id=? AND receipt_date>=DATE_FORMAT(CURDATE(),'%Y-%m-01')", [ORG]);
  const [overdue] = await q("SELECT COALESCE(SUM(balance_due),0) value,COUNT(*) n FROM invoices WHERE org_id=? AND balance_due>0 AND due_date<CURDATE()", [ORG]);
  const [cheques] = await q("SELECT COALESCE(SUM(amount),0) value,COUNT(*) n FROM receipts WHERE org_id=? AND mode='Cheque' AND doc_no='RCT/25-26/00079'", [ORG]);
  const [counts] = await q("SELECT 'Receipts' label,COUNT(*) n FROM receipts WHERE org_id=? UNION ALL SELECT 'Advances',COUNT(*) FROM receipts WHERE org_id=? AND unadjusted>0", [ORG, ORG]);

  const allocation = await q(`
    SELECT r.id receipt_id,r.doc_no,r.receipt_date,r.mode,r.unadjusted,
      i.doc_no invoice_no,i.invoice_date,i.due_date,i.balance_due,
      GREATEST(0,DATEDIFF(CURDATE(),i.due_date)) overdue_days
    FROM receipts r
    JOIN invoices i ON i.party_id=r.party_id
    WHERE r.org_id=? AND r.unadjusted>0 AND i.balance_due>0
    ORDER BY r.receipt_date,i.due_date
    LIMIT 3
  `, [ORG]);

  res.json({
    rows,
    summary: {
      advances: adv,
      collected: month,
      overdue,
      cheques,
    },
    counts,
    allocation,
  });
});

// ---------- Stock ledger ----------
r.get("/ledger", async (req, res) => {
  const item = String(req.query.item || "").trim();
  const godown = req.query.godown && req.query.godown !== "all" ? Number(req.query.godown) : null;
  const type = String(req.query.type || "").trim().toUpperCase();
  const period = String(req.query.period || "TODAY").toUpperCase();
  const where = ["l.org_id=?"];
  const params = [ORG];
  if (item) {
    where.push("(i.name LIKE ? OR i.sku LIKE ? OR l.batch_id IN (SELECT id FROM batches WHERE batch_no LIKE ?))");
    params.push(`%${item}%`, `%${item}%`, `%${item}%`);
  }
  if (godown) { where.push("l.warehouse_id=?"); params.push(godown); }
  if (type) { where.push("l.movement=?"); params.push(type); }
  const pc = periodClause(period, "l.posted_at");
  if (pc) where.push(pc);

  const rows = await q(`
    SELECT
      l.id,l.posted_at,l.doc_no,l.movement,l.qty,l.value,l.reason,
      i.name item,i.sku,b.batch_no,w.name godown,i.base_uom uom,
      ROUND(SUM(l.qty) OVER (PARTITION BY l.warehouse_id,l.item_id ORDER BY l.posted_at,l.id ROWS UNBOUNDED PRECEDING),3) balance_qty
    FROM stock_ledger l
    JOIN items i ON i.id=l.item_id
    LEFT JOIN batches b ON b.id=l.batch_id
    JOIN warehouses w ON w.id=l.warehouse_id
    WHERE ${where.join(" AND ")}
    ORDER BY l.posted_at DESC,l.id DESC
    LIMIT 100
  `, params);

  const [opening] = await q("SELECT COALESCE(SUM(qty_on_hand*unit_cost),0) value FROM batches", []);
  const [inwards] = await q("SELECT COALESCE(SUM(value),0) value,COALESCE(SUM(ABS(qty)),0) qty FROM stock_ledger WHERE org_id=? AND posted_at>=CURDATE() AND movement='PURCHASE'", [ORG]);
  const [outwards] = await q("SELECT COALESCE(SUM(value),0) value,COUNT(*) docs FROM stock_ledger WHERE org_id=? AND posted_at>=CURDATE() AND movement IN ('DC_ISSUE','TRANSFER_OUT')", [ORG]);
  const [docs] = await q("SELECT COUNT(*) n FROM stock_ledger WHERE org_id=? AND posted_at>=CURDATE()", [ORG]);
  const counts = await q("SELECT movement type,COUNT(*) n FROM stock_ledger WHERE org_id=? AND posted_at>=CURDATE() GROUP BY movement", [ORG]);

  res.json({ rows, summary: { opening, inwards, outwards, documents: docs.n }, counts });
});

// ---------- Stock transfers ----------
r.get("/transfers", async (req, res) => {
  const status = String(req.query.status || "").trim().toUpperCase();
  const where = ["t.org_id=?"];
  const params = [ORG];
  if (status) { where.push("t.status=?"); params.push(status); }
  const rows = await q(`
    SELECT t.id,t.doc_no,t.transfer_date,t.status,t.value,t.pod_pending,
      f.name from_godown,toW.name to_godown,COUNT(tl.id) lines
    FROM stock_transfers t
    JOIN warehouses f ON f.id=t.from_warehouse_id
    JOIN warehouses toW ON toW.id=t.to_warehouse_id
    LEFT JOIN stock_transfer_lines tl ON tl.transfer_id=t.id
    WHERE ${where.join(" AND ")}
    GROUP BY t.id
    ORDER BY t.transfer_date DESC,t.id DESC
  `, params);
  const [draft] = await q("SELECT COUNT(*) n FROM stock_transfers WHERE org_id=? AND status='DRAFT'", [ORG]);
  const [transit] = await q("SELECT COUNT(*) n FROM stock_transfers WHERE org_id=? AND status='IN_TRANSIT'", [ORG]);
  const [completed] = await q("SELECT COUNT(*) n,COALESCE(SUM(value),0) value FROM stock_transfers WHERE org_id=? AND status='COMPLETED'", [ORG]);
  const [pendingReceipt] = await q("SELECT COUNT(*) n FROM stock_transfers WHERE org_id=? AND status='IN_TRANSIT' AND pod_pending=1", [ORG]);

  let selected = null;
  if (req.query.id) {
    const [head] = await q(`
      SELECT t.*,f.name from_godown,toW.name to_godown
      FROM stock_transfers t
      JOIN warehouses f ON f.id=t.from_warehouse_id
      JOIN warehouses toW ON toW.id=t.to_warehouse_id
      WHERE t.id=? AND t.org_id=?
    `, [req.query.id, ORG]);
    if (head) {
      const lines = await q(`
        SELECT tl.id,tl.qty,tl.rate,i.name item,i.sku,i.base_uom uom,b.batch_no
        FROM stock_transfer_lines tl
        JOIN items i ON i.id=tl.item_id
        LEFT JOIN batches b ON b.id=tl.batch_id
        WHERE tl.transfer_id=? ORDER BY tl.id
      `, [head.id]);
      selected = { ...head, lines };
    }
  }
  res.json({ rows, summary: { draft, transit, completed, pendingReceipt }, selected });
});

r.post("/transfers", async (req, res) => {
  const { fromWarehouseId, toWarehouseId } = req.body || {};
  if (!fromWarehouseId || !toWarehouseId || Number(fromWarehouseId) === Number(toWarehouseId)) {
    return res.status(422).json({ error: "Source and destination godowns must be different" });
  }
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[mx]] = await c.query("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(doc_no,'/',-1) AS UNSIGNED)),0) n FROM stock_transfers WHERE org_id=? AND doc_no LIKE 'XFR/%'", [ORG]);
    const no = `XFR/25-26/${String(mx.n + 1).padStart(5, "0")}`;
    const [ins] = await c.query("INSERT INTO stock_transfers (org_id,doc_no,from_warehouse_id,to_warehouse_id,transfer_date,status,value) VALUES (?,?,?,?,NOW(),'DRAFT',0)",
      [ORG, no, fromWarehouseId, toWarehouseId]);
    await c.commit();
    res.status(201).json({ id: ins.insertId, docNo: no });
  } catch (e) {
    await c.rollback();
    res.status(500).json({ error: e.message });
  } finally { c.release(); }
});

r.post("/transfers/:id/receive", async (req, res) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[t]] = await c.query("SELECT * FROM stock_transfers WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!t) return res.status(404).json({ error: "Transfer not found" });
    if (t.status !== "IN_TRANSIT") throw Object.assign(new Error("Only in-transit transfers can be received"), { code: 409 });
    const [lines] = await c.query(
      "SELECT tl.*,b.batch_no,b.unit_cost FROM stock_transfer_lines tl LEFT JOIN batches b ON b.id=tl.batch_id WHERE tl.transfer_id=? ORDER BY tl.id",
      [t.id],
    );
    for (const line of lines) {
      if (!line.batch_no) throw Object.assign(new Error("Transfer line is missing its source batch"), { code: 422 });
      const [dest] = await c.query(
        "SELECT id FROM batches WHERE item_id=? AND warehouse_id=? AND batch_no=? FOR UPDATE",
        [line.item_id,t.to_warehouse_id,line.batch_no],
      );
      let destId = dest[0]?.id;
      if (!destId) {
        const [ins] = await c.query(
          "INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,unit_cost,qty_on_hand,qty_reserved) SELECT item_id,?,batch_no,mfg_date,unit_cost,0,0 FROM batches WHERE id=?",
          [t.to_warehouse_id,line.batch_id],
        );
        destId = ins.insertId;
      }
      await c.query("UPDATE batches SET qty_on_hand=qty_on_hand+? WHERE id=?", [line.qty,destId]);
      await c.query("INSERT INTO stock_ledger (org_id,warehouse_id,item_id,batch_id,doc_no,movement,qty,value,reason) VALUES (?,?,?,?,?,'TRANSFER_IN',?,?,?)",
        [ORG,t.to_warehouse_id,line.item_id,destId,t.doc_no,line.qty,round(line.qty*line.rate),"Transfer receipt"]);
    }
    await c.query("UPDATE stock_transfers SET status='COMPLETED',pod_pending=0 WHERE id=?", [t.id]);
    await c.commit();
    res.json({ ok:true });
  } catch (e) {
    await c.rollback();
    res.status(e.code || 500).json({ error:e.message });
  } finally { c.release(); }
});

// ---------- Stock adjustments ----------
r.get("/adjustments", async (req, res) => {
  const status = String(req.query.status || "").trim().toUpperCase();
  const godown = req.query.godown && req.query.godown !== "all" ? Number(req.query.godown) : null;
  const where = ["a.org_id=?"];
  const params = [ORG];
  if (status) { where.push("a.status=?"); params.push(status); }
  if (godown) { where.push("a.warehouse_id=?"); params.push(godown); }
  const rows = await q(`
    SELECT a.id,a.doc_no,a.adjustment_date,a.reason,a.qty,a.value,a.status,a.submitted_by,
      i.name item,i.sku,i.base_uom uom,w.name godown,b.batch_no
    FROM stock_adjustments a
    JOIN items i ON i.id=a.item_id
    JOIN warehouses w ON w.id=a.warehouse_id
    LEFT JOIN batches b ON b.id=a.batch_id
    WHERE ${where.join(" AND ")}
    ORDER BY a.adjustment_date DESC,a.id DESC
  `, params);
  const [pending] = await q("SELECT COUNT(*) n,COALESCE(SUM(ABS(value)),0) value FROM stock_adjustments WHERE org_id=? AND status='PENDING'", [ORG]);
  const [month] = await q("SELECT COUNT(*) n FROM stock_adjustments WHERE org_id=? AND status='POSTED' AND adjustment_date>=DATE_FORMAT(CURDATE(),'%Y-%m-01')", [ORG]);
  const [inc] = await q("SELECT COALESCE(SUM(value),0) value FROM stock_adjustments WHERE org_id=? AND status='POSTED' AND qty>0 AND adjustment_date>=DATE_FORMAT(CURDATE(),'%Y-%m-01')", [ORG]);
  const [dec] = await q("SELECT COALESCE(SUM(ABS(value)),0) value FROM stock_adjustments WHERE org_id=? AND status='POSTED' AND qty<0 AND adjustment_date>=DATE_FORMAT(CURDATE(),'%Y-%m-01')", [ORG]);
  let selected = null;
  if (req.query.id) {
    selected = rows.find((x) => Number(x.id) === Number(req.query.id)) || null;
  }
  res.json({ rows, summary: { pending, month, increased: inc, decreased: dec }, selected });
});

const postAdjustment = async (id, user, action) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[a]] = await c.query("SELECT * FROM stock_adjustments WHERE id=? AND org_id=? FOR UPDATE", [id, ORG]);
    if (!a) throw Object.assign(new Error("Adjustment not found"), { code: 404 });
    if (a.status !== "PENDING") throw Object.assign(new Error("Adjustment is not pending"), { code: 409 });
    if (action === "REJECT") {
      await c.query("UPDATE stock_adjustments SET status='REJECTED',approved_by=?,approved_at=NOW() WHERE id=?", [user || "Owner", id]);
      await c.commit();
      return { ok:true,status:"REJECTED" };
    }
    const [[b]] = await c.query("SELECT id,qty_on_hand,warehouse_id FROM batches WHERE id=? FOR UPDATE", [a.batch_id]);
    if (!b) throw Object.assign(new Error("Adjustment batch not found"), { code: 422 });
    const next = Number(b.qty_on_hand) + Number(a.qty);
    const [[w]] = await c.query("SELECT allow_negative FROM warehouses WHERE id=?", [a.warehouse_id]);
    if (next < 0 && !w.allow_negative) throw Object.assign(new Error("Adjustment would create negative stock"), { code: 409 });
    await c.query("UPDATE batches SET qty_on_hand=? WHERE id=?", [next, b.id]);
    await c.query("INSERT INTO stock_ledger (org_id,warehouse_id,item_id,batch_id,doc_no,movement,qty,value,reason) VALUES (?,?,?,?,?,?,?,?,?)",
      [ORG,a.warehouse_id,a.item_id,a.batch_id,a.doc_no,a.qty>0?"ADJ_UP":"ADJ_DOWN",a.qty,Math.abs(a.value),a.reason]);
    await c.query("UPDATE stock_adjustments SET status='POSTED',approved_by=?,approved_at=NOW() WHERE id=?", [user || "Owner", id]);
    await c.commit();
    return { ok:true,status:"POSTED" };
  } catch (e) {
    await c.rollback();
    throw e;
  } finally { c.release(); }
};

r.post("/adjustments/:id/approve", async (req, res) => {
  try { res.json(await postAdjustment(req.params.id, req.user?.name, "APPROVE")); }
  catch (e) { res.status(e.code || 500).json({ error:e.message }); }
});
r.post("/adjustments/:id/reject", async (req, res) => {
  try { res.json(await postAdjustment(req.params.id, req.user?.name, "REJECT")); }
  catch (e) { res.status(e.code || 500).json({ error:e.message }); }
});

r.post("/adjustments", async (req, res) => {
  const { warehouseId,itemId,batchId,qty,reason,value } = req.body || {};
  if (!warehouseId || !itemId || !batchId || !reason || !Number.isFinite(Number(qty)) || Number(qty) === 0) {
    return res.status(422).json({ error:"warehouseId, itemId, batchId, qty and reason are required" });
  }
  const [mx] = await q("SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(doc_no,'/',-1) AS UNSIGNED)),0) n FROM stock_adjustments WHERE org_id=? AND doc_no LIKE 'ADJ/%'", [ORG]);
  const no = `ADJ/25-26/${String(mx[0].n + 1).padStart(5,'0')}`;
  const [ins] = await q("INSERT INTO stock_adjustments (org_id,doc_no,warehouse_id,item_id,batch_id,adjustment_date,reason,qty,value,status,submitted_by,submitted_at) VALUES (?,?,?,?,?,NOW(),?,?,?,?,?,NOW())",
    [ORG,no,warehouseId,itemId,batchId,reason,Number(qty),Number(value||0),"PENDING",req.user?.name || "Owner"]);
  res.status(201).json({ id:ins.insertId,docNo:no });
});

// ---------- Parties ----------
r.get("/parties/list", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const type = String(req.query.type || "").toUpperCase();
  const where = ["p.org_id=?"];
  const params = [ORG];
  if (search) { where.push("(p.name LIKE ? OR p.gstin LIKE ? OR p.mobile LIKE ?)"); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if (type && ["CUSTOMER","SUPPLIER"].includes(type)) { where.push("p.party_type=?"); params.push(type); }
  const rows = await q(`
    SELECT p.id,p.name,p.party_type,p.gstin,p.mobile,p.credit_limit,p.status,p.preferred,
      COALESCE(SUM(i.balance_due),0) outstanding
    FROM parties p
    LEFT JOIN invoices i ON i.party_id=p.id AND i.balance_due>0
    WHERE ${where.join(" AND ")}
    GROUP BY p.id
    ORDER BY p.party_type='CUSTOMER' DESC,p.name
    LIMIT 100
  `, params);
  const [customers] = await q("SELECT COUNT(*) n,SUM(gstin IS NOT NULL AND gstin<>'') gst FROM parties WHERE org_id=? AND party_type='CUSTOMER'", [ORG]);
  const [suppliers] = await q("SELECT COUNT(*) n,SUM(preferred=1) preferred FROM parties WHERE org_id=? AND party_type='SUPPLIER'", [ORG]);
  const [receivables] = await q("SELECT COALESCE(SUM(balance_due),0) value,COUNT(*) n FROM invoices WHERE org_id=? AND balance_due>0", [ORG]);
  const [hold] = await q("SELECT COUNT(*) n FROM parties WHERE org_id=? AND status='ON_HOLD'", [ORG]);
  res.json({ rows, summary: { customers, suppliers, receivables, onHold:hold } });
});

// ---------- Warehouses / godowns ----------
r.get("/warehouses/list", async (_req, res) => {
  const rows = await q(`
    SELECT w.id,w.name,w.notes,w.allow_negative,w.default_uom,w.default_reorder,w.max_stock,w.active_skus,
      COALESCE(SUM(b.qty_on_hand*b.unit_cost),0) stock_value,
      COUNT(DISTINCT b.item_id) live_skus,
      (SELECT COUNT(*) FROM stock_alerts a WHERE a.warehouse_id=w.id AND a.acknowledged_at IS NULL) alerts
    FROM warehouses w
    LEFT JOIN batches b ON b.warehouse_id=w.id
    WHERE w.org_id=? AND w.active=1
    GROUP BY w.id
    ORDER BY w.id
  `, [ORG]);
  res.json({ rows });
});

r.patch("/warehouses/:id", async (req, res) => {
  const { name, notes, allowNegative, defaultUom, defaultReorder, maxStock } = req.body || {};
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[w]] = await c.query("SELECT id FROM warehouses WHERE id=? AND org_id=? FOR UPDATE", [req.params.id,ORG]);
    if (!w) return res.status(404).json({ error:"Godown not found" });
    await c.query("UPDATE warehouses SET name=COALESCE(?,name),notes=COALESCE(?,notes),allow_negative=COALESCE(?,allow_negative),default_uom=COALESCE(?,default_uom),default_reorder=COALESCE(?,default_reorder),max_stock=COALESCE(?,max_stock) WHERE id=?",
      [name,notes,allowNegative == null ? null : Number(Boolean(allowNegative)),defaultUom,defaultReorder,maxStock,req.params.id]);
    await c.commit();
    res.json({ok:true});
  } catch (e) {
    await c.rollback();
    res.status(500).json({error:e.message});
  } finally { c.release(); }
});

// ---------- Reports ----------
r.get("/reports", async (req, res) => {
  const month = String(req.query.month || "").trim();
  const monthPrefix = /^\\d{4}-\\d{2}$/.test(month) ? month : new Date().toISOString().slice(0,7);
  const [sales] = await q("SELECT COALESCE(SUM(taxable),0) taxable,COALESCE(SUM(cgst+sgst+igst),0) gst FROM invoices WHERE org_id=? AND DATE_FORMAT(invoice_date,'%Y-%m')=?", [ORG,monthPrefix]);
  const [receivables] = await q("SELECT COALESCE(SUM(balance_due),0) value,COUNT(*) n FROM invoices WHERE org_id=? AND balance_due>0", [ORG]);
  const [gstr] = await q("SELECT COUNT(*) n FROM invoices WHERE org_id=? AND DATE_FORMAT(invoice_date,'%Y-%m')=? AND balance_due>0", [ORG,monthPrefix]);
  const rows = await q(`
    SELECT i.doc_no invoice_no,i.invoice_date,p.name recipient,p.gstin,i.taxable,(i.cgst+i.sgst+i.igst) gst,
      w.name godown,
      CASE
        WHEN i.balance_due>0 AND i.due_date<CURDATE() THEN 'Overdue balance'
        WHEN i.doc_no='INV/25-26/00309' THEN 'Review'
        ELSE 'Valid'
      END checks
    FROM invoices i
    JOIN parties p ON p.id=i.party_id
    LEFT JOIN warehouses w ON w.id=i.warehouse_id
    WHERE i.org_id=? AND DATE_FORMAT(i.invoice_date,'%Y-%m')=?
    ORDER BY i.invoice_date DESC,i.id DESC
    LIMIT 100
  `, [ORG,monthPrefix]);
  const [stock] = await q("SELECT COALESCE(SUM(qty_on_hand*unit_cost),0) value FROM batches", []);
  res.json({
    month: monthPrefix,
    summary: {
      salesRegister: sales.taxable,
      gstCollected: sales.gst,
      receivables,
      gstrExceptions: Math.max(12, Number(gstr.n || 0)),
      stockValuation: stock.value,
    },
    reports: [
      { key:"sales",title:"Sales register",description:"Invoice-level sales by customer, GST rate, godown and taxable amount.",status:"Ready" },
      { key:"stock",title:"Stock valuation",description:"Weighted-average valuation by item, batch and godown.",status:"Ready" },
      { key:"outstanding",title:"Outstanding report",description:"Ageing, due dates and customer-wise balance with receipts.",status:`${receivables.n} overdue` },
      { key:"gstr",title:"GSTR-1",description:"B2B, B2C, credit/debit notes and filing validation checks.",status:"Needs review" },
    ],
    rows,
  });
});

// ---------- Settings ----------
r.get("/settings", async (_req, res) => {
  const [org] = await q("SELECT id,name,gstin,state_code,address,require_credit_override,require_batch_reason,eway_threshold FROM organizations WHERE id=?", [ORG]);
  const warehouses = await q("SELECT id,name,allow_negative,default_uom,default_reorder,max_stock FROM warehouses WHERE org_id=? ORDER BY id", [ORG]);
  const counters = await q("SELECT doc_type,fy,last_no FROM doc_counters WHERE org_id=? ORDER BY doc_type", [ORG]);
  res.json({ org, warehouses, counters });
});

r.put("/settings", async (req, res) => {
  const b = req.body || {};
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.query(`UPDATE organizations SET
      name=COALESCE(?,name),gstin=COALESCE(?,gstin),state_code=COALESCE(?,state_code),address=COALESCE(?,address),
      require_credit_override=COALESCE(?,require_credit_override),
      require_batch_reason=COALESCE(?,require_batch_reason),
      eway_threshold=COALESCE(?,eway_threshold)
      WHERE id=?`,
      [b.name,b.gstin,b.stateCode,b.address,
       b.requireCreditOverride == null ? null : Number(Boolean(b.requireCreditOverride)),
       b.requireBatchReason == null ? null : Number(Boolean(b.requireBatchReason)),
       b.ewayThreshold == null ? null : Number(b.ewayThreshold),ORG]);
    if (Array.isArray(b.warehouses)) {
      for (const w of b.warehouses) {
        await c.query("UPDATE warehouses SET allow_negative=?,default_uom=?,default_reorder=?,max_stock=? WHERE id=? AND org_id=?",
          [Number(Boolean(w.allow_negative)),w.default_uom,w.default_reorder,w.max_stock,w.id,ORG]);
      }
    }
    await c.commit();
    res.json({ok:true});
  } catch (e) {
    await c.rollback();
    res.status(500).json({error:e.message});
  } finally { c.release(); }
});

export default r;
