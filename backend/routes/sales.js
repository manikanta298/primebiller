import { Router } from "express";
import { pool, q } from "../db.js";

const r = Router();
import { ORG } from "../org.js";
const EWB_LIMIT = 50000;
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const calcLine = (l) => {
  const gross = l.qty * l.rate, taxable = round(gross * (1 - (l.disc_pct || 0) / 100));
  return { gross, taxable, amount: round(taxable * (1 + l.gst_pct / 100)) };
};
const totals = (lines, intra) => {
  const t = lines.reduce((a, l) => { const c = calcLine(l); a.gross += c.gross; a.taxable += c.taxable; a.tax += c.amount - c.taxable; return a; }, { gross: 0, taxable: 0, tax: 0 });
  const tax = round(t.tax);
  return { gross: round(t.gross), discount: round(t.gross - t.taxable), taxable: round(t.taxable),
    cgst: intra ? round(tax / 2) : 0, sgst: intra ? round(tax / 2) : 0, igst: intra ? 0 : tax, total: round(t.taxable + tax) };
};
const nextNo = async (c, type, prefix) => {
  const [[row]] = await c.query("SELECT last_no FROM doc_counters WHERE org_id=? AND doc_type=? AND fy='25-26' FOR UPDATE", [ORG, type]);
  const n = (row?.last_no || 0) + 1;
  await c.query("INSERT INTO doc_counters VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE last_no=?", [ORG, type, "25-26", n, n]);
  return `${prefix}/25-26/${String(n).padStart(5, "0")}`;
};

// Item picker with availability
r.get("/items/search", async (req, res) => {
  const t = `%${String(req.query.q || "").replace(/\s+/g, "%")}%`;
  res.json(await q(`SELECT i.id,i.sku,i.name,i.hsn,i.gst_rate,i.base_uom uom,
      COALESCE(SUM(b.qty_on_hand),0) on_hand, COALESCE(SUM(b.qty_on_hand-b.qty_reserved),0) free
    FROM items i LEFT JOIN batches b ON b.item_id=i.id AND (?=0 OR b.warehouse_id=?)
    WHERE i.org_id=? AND (i.name LIKE ? OR i.sku LIKE ?) AND i.sku<>'MISC-OPEN' GROUP BY i.id ORDER BY i.name LIMIT 8`,
    [Number(req.query.godown || 0), Number(req.query.godown || 0), ORG, t, t]));
});

const loadSO = async (id) => {
  const [so] = await q(`SELECT s.*,p.name customer,p.gstin,p.credit_limit FROM sales_orders s JOIN parties p ON p.id=s.party_id WHERE s.id=?`, [id]);
  if (!so) return null;
  const lines = await q(`SELECT l.*,i.name item,i.sku,i.hsn,
      (SELECT COALESCE(SUM(qty_on_hand),0) FROM batches WHERE item_id=l.item_id AND warehouse_id=l.warehouse_id) on_hand,
      (SELECT COALESCE(SUM(qty_on_hand-qty_reserved),0) FROM batches WHERE item_id=l.item_id AND warehouse_id=l.warehouse_id) free,
      (SELECT name FROM warehouses WHERE id=l.warehouse_id) godown
    FROM sales_order_lines l JOIN items i ON i.id=l.item_id WHERE l.so_id=? ORDER BY l.line_no`, [id]);
  const intra = !so.gstin || so.gstin.slice(0, 2) === "36";
  const [{ out }] = await q("SELECT COALESCE(SUM(balance_due),0) `out` FROM invoices WHERE party_id=?", [so.party_id]);
  const tot = totals(lines, intra);
  return { ...so, lines, totals: tot, intra,
    credit: { limit: so.credit_limit, outstanding: out, headroom: so.credit_limit - out - tot.total } };
};
r.get("/sales-orders/current", async (_q, res) => {
  const [row] = await q("SELECT id FROM sales_orders WHERE doc_no='SO/25-26/00042'"); res.json(row || null);
});
r.get("/sales-orders/:id", async (req, res) => { const so = await loadSO(req.params.id); so ? res.json(so) : res.status(404).json({ error: "Not found" }); });

r.put("/sales-orders/:id", async (req, res) => {
  const { party_id, order_date, ship_to, warehouse_id, terms, lines = [] } = req.body;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[st]] = await c.query("SELECT status FROM sales_orders WHERE id=? FOR UPDATE", [req.params.id]);
    if (st?.status !== "DRAFT") throw Object.assign(new Error("Only drafts can be edited"), { code: 409 });
    await c.query("DELETE FROM sales_order_lines WHERE so_id=?", [req.params.id]);
    let n = 1, taxable = 0, total = 0;
    for (const l of lines.filter((x) => x.item_id && Number(x.qty) > 0)) {
      const k = calcLine({ ...l, qty: +l.qty, rate: +l.rate, disc_pct: +l.disc_pct || 0, gst_pct: +l.gst_pct });
      taxable += k.taxable; total += k.amount;
      await c.query("INSERT INTO sales_order_lines (so_id,line_no,item_id,warehouse_id,qty,uom,rate,disc_pct,gst_pct,taxable,amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [req.params.id, n++, l.item_id, l.warehouse_id || warehouse_id, l.qty, l.uom, l.rate, l.disc_pct || 0, l.gst_pct, k.taxable, k.amount]);
    }
    await c.query("UPDATE sales_orders SET party_id=?,order_date=?,ship_to=?,warehouse_id=?,terms=?,taxable=?,tax=?,total=?,autosaved_at=NOW() WHERE id=?",
      [party_id, order_date, ship_to, warehouse_id, terms, round(taxable), round(total - taxable), round(total), req.params.id]);
    await c.commit(); res.json(await loadSO(req.params.id));
  } catch (e) { await c.rollback(); res.status(e.code || 500).json({ error: e.message }); } finally { c.release(); }
});

// Confirm & hold stock: credit check (Owner override), then reserve FIFO
r.post("/sales-orders/:id/confirm", async (req, res) => {
  const so = await loadSO(req.params.id);
  if (!so || so.status !== "DRAFT") return res.status(409).json({ error: "Order is not a draft" });
  if (so.credit.headroom < 0 && !req.body?.ownerOverride) return res.status(409).json({ error: "Credit limit exceeded — an Owner override is required", code: "CREDIT_OVERRIDE" });
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    for (const l of so.lines) {
      let need = l.qty;
      const [bs] = await c.query(`SELECT id,qty_on_hand-qty_reserved free FROM batches WHERE item_id=? AND warehouse_id=? AND qty_on_hand>qty_reserved
        AND (expiry_date IS NULL OR expiry_date>=CURDATE()) ORDER BY mfg_date,id FOR UPDATE`, [l.item_id, l.warehouse_id]);
      for (const b of bs) { const take = Math.min(need, b.free); if (take <= 0) continue;
        await c.query("UPDATE batches SET qty_reserved=qty_reserved+? WHERE id=?", [take, b.id]); need -= take; }
      if (need > 0.0005) throw Object.assign(new Error(`Insufficient free stock for ${l.item}`), { code: 409 });
    }
    await c.query("UPDATE sales_orders SET status='CONFIRMED' WHERE id=?", [req.params.id]);
    await c.commit(); res.json({ ok: true });
  } catch (e) { await c.rollback(); res.status(e.code || 500).json({ error: e.message }); } finally { c.release(); }
});

// ---------- Delivery challan ----------
const fifo = (batches, want) => { const out = {}; let left = want;
  for (const b of batches) { const t = Math.min(left, b.free); if (t > 0) { out[b.id] = t; left -= t; } } return out; };

const loadDC = async (id) => {
  const [dc] = await q(`SELECT c.*,p.name customer,s.doc_no so_no,s.ship_to FROM challans c JOIN parties p ON p.id=c.party_id LEFT JOIN sales_orders s ON s.id=c.so_id WHERE c.id=?`, [id]);
  if (!dc) return null;
  const soLines = await q(`SELECT l.id,l.qty ordered,l.qty_sent already_sent,l.rate,l.gst_pct,l.disc_pct,l.warehouse_id,i.id item_id,i.name item,i.sku,i.base_uom uom,w.name godown
    FROM sales_order_lines l JOIN items i ON i.id=l.item_id JOIN warehouses w ON w.id=l.warehouse_id WHERE l.so_id=? ORDER BY l.line_no`, [dc.so_id]);
  const alloc = await q("SELECT * FROM challan_lines WHERE challan_id=?", [id]);
  const lines = [];
  for (const l of soLines) {
    const same = l.warehouse_id === dc.warehouse_id;
    const batches = same ? await q(`SELECT id,batch_no,mfg_date,qty_on_hand-qty_reserved+COALESCE((SELECT SUM(qty) FROM challan_lines WHERE challan_id=? AND batch_id=batches.id),0) free
      FROM batches WHERE item_id=? AND warehouse_id=? AND (expiry_date IS NULL OR expiry_date>=CURDATE()) AND qty_on_hand>0 ORDER BY mfg_date,id`, [id, l.item_id, l.warehouse_id]) : [];
    const mine = alloc.filter((a) => a.so_line_id === l.id);
    const thisQty = mine.reduce((s, a) => s + a.qty, 0), suggested = fifo(batches, thisQty);
    lines.push({ ...l, excluded: !same, batches: batches.map((b) => ({ ...b, qty: mine.find((a) => a.batch_id === b.id)?.qty || 0, fifo_qty: suggested[b.id] || 0,
      reason: mine.find((a) => a.batch_id === b.id)?.override_reason || null })),
      this_challan: thisQty, pending_after: l.ordered - l.already_sent - thisQty });
  }
  const gc = calcLine; let taxable = 0, total = 0;
  for (const l of lines) { const k = gc({ qty: l.this_challan, rate: l.rate, disc_pct: l.disc_pct, gst_pct: l.gst_pct }); taxable += k.taxable; total += k.amount; }
  const [ewb] = await q("SELECT * FROM eway_bills WHERE challan_id=?", [id]);
  return { ...dc, lines, taxable: round(taxable), tax: round(total - taxable), total: round(total), ewbRequired: total > EWB_LIMIT, ewb: ewb || null };
};

r.get("/challans/for-so/:soId", async (req, res) => {   // create-or-get the open draft challan for an order
  let [dc] = await q("SELECT id FROM challans WHERE so_id=? AND status='DRAFT' LIMIT 1", [req.params.soId]);
  if (!dc) {
    const so = await loadSO(req.params.soId); if (!so) return res.status(404).json({ error: "Order not found" });
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const no = await nextNo(c, "DC", "DC");
      const [ins] = await c.query("INSERT INTO challans (org_id,doc_no,so_id,party_id,warehouse_id,challan_date,status) VALUES (?,?,?,?,?,NOW(),'DRAFT')", [ORG, no, so.id, so.party_id, so.warehouse_id]);
      for (const l of so.lines.filter((x) => x.warehouse_id === so.warehouse_id)) {
        const [bs] = await c.query("SELECT id,qty_on_hand-qty_reserved free FROM batches WHERE item_id=? AND warehouse_id=? AND qty_on_hand>0 AND (expiry_date IS NULL OR expiry_date>=CURDATE()) ORDER BY mfg_date,id", [l.item_id, l.warehouse_id]);
        for (const [bid, qty] of Object.entries(fifo(bs, Math.min(l.qty - l.qty_sent, bs.reduce((s, b) => s + Math.max(b.free, 0), 0)))))
          await c.query("INSERT INTO challan_lines (challan_id,so_line_id,item_id,batch_id,qty,rate) VALUES (?,?,?,?,?,?)", [ins.insertId, l.id, l.item_id, bid, qty, l.rate]);
      }
      await c.commit(); dc = { id: ins.insertId };
    } catch (e) { await c.rollback(); return res.status(500).json({ error: e.message }); } finally { c.release(); }
  }
  res.json(await loadDC(dc.id));
});
r.get("/challans/:id", async (req, res) => { const d = await loadDC(req.params.id); d ? res.json(d) : res.status(404).json({ error: "Not found" }); });

r.put("/challans/:id", async (req, res) => {
  const { transport = {}, allocations = [] } = req.body;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[st]] = await c.query("SELECT status FROM challans WHERE id=? FOR UPDATE", [req.params.id]);
    if (st?.status !== "DRAFT") throw Object.assign(new Error("Challan already dispatched"), { code: 409 });
    await c.query("DELETE FROM challan_lines WHERE challan_id=?", [req.params.id]);
    for (const a of allocations.filter((x) => +x.qty > 0)) {
      const [[b]] = await c.query("SELECT qty_on_hand-qty_reserved free FROM batches WHERE id=?", [a.batch_id]);
      if (+a.qty > b.free + 0.0005) throw Object.assign(new Error("Allocation exceeds free stock in batch"), { code: 422 });
      await c.query("INSERT INTO challan_lines (challan_id,so_line_id,item_id,batch_id,qty,rate,override_reason) VALUES (?,?,?,?,?,?,?)", [req.params.id, a.so_line_id, a.item_id, a.batch_id, a.qty, a.rate, a.reason || null]);
    }
    await c.query("UPDATE challans SET vehicle_no=?,distance_km=?,driver=?,driver_mobile=?,transporter=? WHERE id=?",
      [transport.vehicle_no, transport.distance_km || null, transport.driver, transport.driver_mobile, transport.transporter, req.params.id]);
    await c.commit(); res.json(await loadDC(req.params.id));
  } catch (e) { await c.rollback(); res.status(e.code || 500).json({ error: e.message }); } finally { c.release(); }
});

// Dispatch & post stock — one transaction; e-way bill is idempotent (singleton per consignment)
r.post("/challans/:id/dispatch", async (req, res) => {
  const dc = await loadDC(req.params.id);
  if (!dc || dc.status !== "DRAFT") return res.status(409).json({ error: "Challan is not a draft" });
  if (!dc.total) return res.status(422).json({ error: "Nothing allocated" });
  if (!dc.vehicle_no) return res.status(422).json({ error: "Vehicle number is required" });
  if (dc.ewbRequired && !req.body?.generateEwb) return res.status(422).json({ error: "An e-way bill is mandatory above ₹50,000", code: "EWB_REQUIRED" });
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const rows = await c.query("SELECT * FROM challan_lines WHERE challan_id=?", [dc.id]).then((x) => x[0]);
    for (const a of rows) {
      const [[b]] = await c.query("SELECT qty_on_hand,qty_reserved,unit_cost FROM batches WHERE id=? FOR UPDATE", [a.batch_id]);
      if (b.qty_on_hand < a.qty) throw Object.assign(new Error("Stock changed — reload the challan"), { code: 409 });
      await c.query("UPDATE batches SET qty_on_hand=qty_on_hand-?, qty_reserved=GREATEST(qty_reserved-?,0) WHERE id=?", [a.qty, a.qty, a.batch_id]);
      await c.query("INSERT INTO stock_ledger (org_id,warehouse_id,item_id,batch_id,doc_no,movement,qty,value,reason) VALUES (?,?,?,?,?, 'DC_ISSUE',?,?,?)",
        [ORG, dc.warehouse_id, a.item_id, a.batch_id, dc.doc_no, -a.qty, round(a.qty * a.rate), a.override_reason]);
      await c.query("UPDATE sales_order_lines SET qty_sent=qty_sent+? WHERE id=?", [a.qty, a.so_line_id]);
    }
    if (dc.ewbRequired) {
      const days = Math.max(1, Math.ceil((dc.distance_km || 1) / 200));
      const valid = new Date(); valid.setDate(valid.getDate() + days); valid.setHours(23, 59, 0, 0);
      const no = String(Math.floor(1e11 + Math.random() * 9e11)) + "0";
      await c.query("INSERT IGNORE INTO eway_bills (challan_id,ewb_no,valid_until,idempotency_key) VALUES (?,?,?,?)", [dc.id, no.slice(0, 12), valid, `dc${dc.id}-ewb`]);
    }
    await c.query("UPDATE challans SET status='IN_TRANSIT',taxable=?,tax=?,total=?,challan_date=NOW() WHERE id=?", [dc.taxable, dc.tax, dc.total, dc.id]);
    const [[open]] = await c.query("SELECT COUNT(*) n FROM sales_order_lines WHERE so_id=? AND qty_sent<qty", [dc.so_id]);
    await c.query("UPDATE sales_orders SET status=? WHERE id=?", [open.n ? "PARTIAL" : "DELIVERED", dc.so_id]);
    await c.commit(); res.json(await loadDC(dc.id));
  } catch (e) { await c.rollback(); res.status(e.code || 500).json({ error: e.message }); } finally { c.release(); }
});

export default r;
