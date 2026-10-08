import { Router } from "express";
import { pool, q } from "../db.js";
import { nextDocNo } from "../services/sales/docNo.js";
import { reserveLine, releaseOrder, consumeReservation, r3 } from "../services/sales/reservations.js";

const r = Router();
import { ORG } from "../org.js";
const EWB_LIMIT = 50000;
export const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const calcLine = (l) => {
  const gross = l.qty * l.rate, taxable = round(gross * (1 - (l.disc_pct || 0) / 100));
  return { gross, taxable, amount: round(taxable * (1 + l.gst_pct / 100)) };
};
export const totals = (lines, intra) => {
  const t = lines.reduce((a, l) => { const c = calcLine(l); a.gross += c.gross; a.taxable += c.taxable; a.tax += c.amount - c.taxable; return a; }, { gross: 0, taxable: 0, tax: 0 });
  const tax = round(t.tax);
  return { gross: round(t.gross), discount: round(t.gross - t.taxable), taxable: round(t.taxable),
    cgst: intra ? round(tax / 2) : 0, sgst: intra ? round(tax / 2) : 0, igst: intra ? 0 : tax, total: round(t.taxable + tax) };
};
const nextNo = (c, type, prefix) => nextDocNo(c, type, prefix);
const fail = (res, e) => res.status(Number.isInteger(e.code) ? e.code : 500).json({ error: e.message });
const bad = (msg, code = 422) => Object.assign(new Error(msg), { code });
const EPS = 0.0005;

// Item picker with availability
r.get("/items/search", async (req, res) => {
  const t = `%${String(req.query.q || "").replace(/\s+/g, "%")}%`;
  res.json(await q(`SELECT i.id,i.sku,i.name,i.hsn,i.gst_rate,i.base_uom uom,
      COALESCE(SUM(b.qty_on_hand),0) on_hand, COALESCE(SUM(b.qty_on_hand-b.qty_reserved),0) free
    FROM items i LEFT JOIN batches b ON b.item_id=i.id AND (?=0 OR b.warehouse_id=?)
    WHERE i.org_id=? AND (i.name LIKE ? OR i.sku LIKE ?) AND i.sku<>'MISC-OPEN' GROUP BY i.id ORDER BY i.name LIMIT 8`,
    [Number(req.query.godown || 0), Number(req.query.godown || 0), ORG, t, t]));
});

export const loadSO = async (id) => {
  const [so] = await q(`SELECT s.*,p.name customer,p.gstin,p.credit_limit FROM sales_orders s JOIN parties p ON p.id=s.party_id WHERE s.id=? AND s.org_id=?`, [id, ORG]);
  if (!so) return null;
  const lines = await q(`SELECT l.*,i.name item,i.sku,i.hsn,
      (SELECT COALESCE(SUM(qty_on_hand),0) FROM batches WHERE item_id=l.item_id AND warehouse_id=l.warehouse_id) on_hand,
      (SELECT COALESCE(SUM(qty_on_hand-qty_reserved),0) FROM batches WHERE item_id=l.item_id AND warehouse_id=l.warehouse_id) free,
      (SELECT name FROM warehouses WHERE id=l.warehouse_id) godown
    FROM sales_order_lines l JOIN items i ON i.id=l.item_id WHERE l.so_id=? ORDER BY l.line_no`, [id]);
  const [org] = await q("SELECT state_code FROM organizations WHERE id=?", [ORG]);
  const intra = !so.gstin || so.gstin.slice(0, 2) === String(org?.state_code || "36");
  const [{ out }] = await q("SELECT COALESCE(SUM(balance_due),0) `out` FROM invoices WHERE party_id=?", [so.party_id]);
  const tot = totals(lines, intra);
  return { ...so, lines, totals: tot, intra,
    credit: { limit: so.credit_limit, outstanding: out, headroom: so.credit_limit - out - tot.total } };
};
r.get("/sales-orders/current", async (_q, res) => {
  const [row] = await q("SELECT id FROM sales_orders WHERE doc_no='SO/25-26/00042'"); res.json(row || null);
});
r.get("/sales-orders/:id", async (req, res) => { const so = await loadSO(req.params.id); so ? res.json(so) : res.status(404).json({ error: "Not found" }); });

// Validates the header and lines and recalculates everything server-side: GST rate and unit come from
// the item master, never from the client.
const cleanOrder = async (c, b) => {
  const [[p]] = await c.query("SELECT id FROM parties WHERE id=? AND org_id=? AND party_type='CUSTOMER'", [b.party_id, ORG]);
  if (!p) throw bad("Select a valid customer");
  const whs = new Map();
  const wh = async (id) => {
    if (!whs.has(id)) { const [[w]] = await c.query("SELECT id,active FROM warehouses WHERE id=? AND org_id=?", [id, ORG]); whs.set(id, w); }
    if (!whs.get(id)?.active) throw bad("Select a valid, active godown");
    return id;
  };
  const head = await wh(Number(b.warehouse_id));
  const raw = (b.lines || []).filter((x) => x.item_id && Number(x.qty) > 0);
  if (!raw.length) throw bad("Add at least one item line");
  const lines = [];
  for (const l of raw) {
    const qty = Number(l.qty), rate = Number(l.rate), disc = Number(l.disc_pct) || 0;
    if (!Number.isFinite(qty) || !(rate >= 0) || disc < 0 || disc > 100) throw bad("Quantity, rate and discount must be valid numbers");
    const [[it]] = await c.query("SELECT id,base_uom,gst_rate FROM items WHERE id=? AND org_id=?", [l.item_id, ORG]);
    if (!it) throw bad("An item on the order does not exist");
    const k = calcLine({ qty, rate, disc_pct: disc, gst_pct: it.gst_rate });
    lines.push({ item_id: it.id, warehouse_id: l.warehouse_id ? await wh(Number(l.warehouse_id)) : head, qty, uom: it.base_uom, rate, disc_pct: disc, gst_pct: it.gst_rate, ...k });
  }
  return { head, lines, taxable: round(lines.reduce((a, l) => a + l.taxable, 0)), total: round(lines.reduce((a, l) => a + l.amount, 0)) };
};
const saveLines = async (c, soId, lines) => {
  let n = 1;
  for (const l of lines) await c.query("INSERT INTO sales_order_lines (so_id,line_no,item_id,warehouse_id,qty,uom,rate,disc_pct,gst_pct,taxable,amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [soId, n++, l.item_id, l.warehouse_id, l.qty, l.uom, l.rate, l.disc_pct, l.gst_pct, l.taxable, l.amount]);
};

r.post("/sales-orders", async (req, res) => {
  const b = req.body || {};
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const o = await cleanOrder(c, b);
    const no = await nextNo(c, "SO", "SO");
    const [ins] = await c.query("INSERT INTO sales_orders (org_id,doc_no,party_id,warehouse_id,order_date,ship_to,terms,reference,notes,status,taxable,tax,total) VALUES (?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?)",
      [ORG, no, b.party_id, o.head, b.order_date || new Date().toISOString().slice(0, 10), b.ship_to || null, b.terms || null, b.reference || null, b.notes || null, o.taxable, round(o.total - o.taxable), o.total]);
    await saveLines(c, ins.insertId, o.lines);
    await c.commit(); res.status(201).json(await loadSO(ins.insertId));
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

r.put("/sales-orders/:id", async (req, res) => {
  const b = req.body || {};
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[st]] = await c.query("SELECT status FROM sales_orders WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!st) throw bad("Not found", 404);
    if (st.status !== "DRAFT") throw bad("Only drafts can be edited", 409);
    const o = await cleanOrder(c, b);
    await c.query("DELETE FROM sales_order_lines WHERE so_id=?", [req.params.id]);
    await saveLines(c, req.params.id, o.lines);
    await c.query("UPDATE sales_orders SET party_id=?,order_date=?,ship_to=?,warehouse_id=?,terms=?,reference=?,notes=?,taxable=?,tax=?,total=?,autosaved_at=NOW() WHERE id=?",
      [b.party_id, b.order_date, b.ship_to || null, o.head, b.terms || null, b.reference || null, b.notes || null, o.taxable, round(o.total - o.taxable), o.total, req.params.id]);
    await c.commit(); res.json(await loadSO(req.params.id));
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

// Confirm & hold stock: credit check (Owner override), then reserve FIFO. Reservation never touches qty_on_hand.
// A shortfall blocks the confirm unless the godown allows negative stock; use /reserve to top up later.
r.post("/sales-orders/:id/confirm", async (req, res) => {
  const so = await loadSO(req.params.id);
  if (!so || so.status !== "DRAFT") return res.status(409).json({ error: "Order is not a draft" });
  if (!so.lines.length) return res.status(422).json({ error: "Order has no lines" });
  if (so.credit.headroom < 0 && !req.body?.ownerOverride) return res.status(409).json({ error: "Credit limit exceeded — an Owner override is required", code: "CREDIT_OVERRIDE" });
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[st]] = await c.query("SELECT status FROM sales_orders WHERE id=? FOR UPDATE", [so.id]);
    if (st.status !== "DRAFT") throw bad("Order is not a draft", 409);
    const [lines] = await c.query("SELECT * FROM sales_order_lines WHERE so_id=? ORDER BY line_no", [so.id]);
    for (const l of lines) {
      const { shortfall } = await reserveLine(c, l);
      if (shortfall > EPS) {
        const [[w]] = await c.query("SELECT allow_negative FROM warehouses WHERE id=?", [l.warehouse_id]);
        if (!w?.allow_negative) throw bad(`Insufficient free stock for ${so.lines.find((x) => x.id === l.id).item}`, 409);
      }
    }
    await c.query("UPDATE sales_orders SET status='CONFIRMED' WHERE id=?", [so.id]);
    await c.commit(); res.json({ ok: true });
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

// Reserve (or top up) stock for a confirmed order. Partial reservation is allowed; calling it again is safe.
r.post("/sales-orders/:id/reserve", async (req, res) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[so]] = await c.query("SELECT id,status FROM sales_orders WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!so) throw bad("Not found", 404);
    if (!["CONFIRMED", "PARTIAL"].includes(so.status)) throw bad("Only confirmed orders can reserve stock", 409);
    const [lines] = await c.query("SELECT * FROM sales_order_lines WHERE so_id=? ORDER BY line_no", [so.id]);
    for (const l of lines) await reserveLine(c, l);
    await c.commit(); res.json(await reservations(so.id));
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

const reservations = async (soId) => {
  const lines = await q(`SELECT l.id so_line_id,l.line_no,i.name item,l.qty ordered,l.qty_sent,
      COALESCE((SELECT SUM(qty) FROM so_reservations WHERE so_line_id=l.id),0) reserved
    FROM sales_order_lines l JOIN items i ON i.id=l.item_id WHERE l.so_id=? ORDER BY l.line_no`, [soId]);
  const batches = await q(`SELECT r.so_line_id,r.batch_id,b.batch_no,r.qty FROM so_reservations r JOIN batches b ON b.id=r.batch_id
    JOIN sales_order_lines l ON l.id=r.so_line_id WHERE l.so_id=? ORDER BY r.so_line_id,r.id`, [soId]);
  return { lines: lines.map((l) => ({ ...l, pending: r3(l.ordered - l.qty_sent - l.reserved), batches: batches.filter((b) => b.so_line_id === l.so_line_id) })) };
};
r.get("/sales-orders/:id/reservations", async (req, res) => {
  const [so] = await q("SELECT id FROM sales_orders WHERE id=? AND org_id=?", [req.params.id, ORG]);
  so ? res.json(await reservations(so.id)) : res.status(404).json({ error: "Not found" });
});

// Cancel a draft or confirmed order that has not been dispatched. Reservations are released; open draft challans are cancelled.
r.post("/sales-orders/:id/cancel", async (req, res) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[so]] = await c.query("SELECT id,status FROM sales_orders WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!so) throw bad("Not found", 404);
    if (!["DRAFT", "CONFIRMED"].includes(so.status)) throw bad(`A ${so.status.toLowerCase()} order cannot be cancelled`, 409);
    const [[sent]] = await c.query("SELECT COUNT(*) n FROM challans WHERE so_id=? AND status NOT IN ('DRAFT','CANCELLED')", [so.id]);
    if (sent.n) throw bad("Goods have already been dispatched against this order", 409);
    await releaseOrder(c, so.id);
    await c.query("UPDATE challans SET status='CANCELLED' WHERE so_id=? AND status='DRAFT'", [so.id]);
    await c.query("UPDATE sales_orders SET status='CANCELLED' WHERE id=?", [so.id]);
    await c.commit(); res.json({ ok: true });
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

// ---------- Delivery challan ----------
const fifo = (batches, want) => { const out = {}; let left = want;
  for (const b of batches) { const t = Math.min(left, b.free); if (t > 0) { out[b.id] = t; left -= t; } } return out; };
// Quantity of a batch the given order line may take: free stock plus what this very line already holds.
const FREE_FOR_LINE = "b.qty_on_hand-b.qty_reserved+COALESCE((SELECT SUM(x.qty) FROM so_reservations x WHERE x.so_line_id=? AND x.batch_id=b.id),0)";

export const loadDC = async (id) => {
  const [dc] = await q(`SELECT c.*,p.name customer,s.doc_no so_no,s.ship_to FROM challans c JOIN parties p ON p.id=c.party_id LEFT JOIN sales_orders s ON s.id=c.so_id WHERE c.id=? AND c.org_id=?`, [id, ORG]);
  if (!dc) return null;
  const soLines = await q(`SELECT l.id,l.qty ordered,l.qty_sent already_sent,l.rate,l.gst_pct,l.disc_pct,l.warehouse_id,i.id item_id,i.name item,i.sku,i.base_uom uom,w.name godown
    FROM sales_order_lines l JOIN items i ON i.id=l.item_id JOIN warehouses w ON w.id=l.warehouse_id WHERE l.so_id=? ORDER BY l.line_no`, [dc.so_id]);
  const alloc = await q("SELECT * FROM challan_lines WHERE challan_id=?", [id]);
  const lines = [];
  for (const l of soLines) {
    const same = l.warehouse_id === dc.warehouse_id;
    const batches = same ? await q(`SELECT b.id,b.batch_no,b.mfg_date,${FREE_FOR_LINE} free
      FROM batches b WHERE b.item_id=? AND b.warehouse_id=? AND (b.expiry_date IS NULL OR b.expiry_date>=CURDATE()) AND b.qty_on_hand>0 ORDER BY b.mfg_date,b.id`, [l.id, l.item_id, l.warehouse_id]) : [];
    const mine = alloc.filter((a) => a.so_line_id === l.id);
    const thisQty = mine.reduce((s, a) => s + a.qty, 0), suggested = fifo(batches, thisQty);
    lines.push({ ...l, excluded: !same, batches: batches.map((b) => ({ ...b, qty: mine.find((a) => a.batch_id === b.id)?.qty || 0, fifo_qty: suggested[b.id] || 0,
      reason: mine.find((a) => a.batch_id === b.id)?.override_reason || null })),
      this_challan: thisQty, pending_after: l.ordered - l.already_sent - thisQty });
  }
  let taxable = 0, total = 0;
  for (const l of lines) { const k = calcLine({ qty: l.this_challan, rate: l.rate, disc_pct: l.disc_pct, gst_pct: l.gst_pct }); taxable += k.taxable; total += k.amount; }
  const [ewb] = await q("SELECT * FROM eway_bills WHERE challan_id=?", [id]);
  return { ...dc, lines, taxable: round(taxable), tax: round(total - taxable), total: round(total), ewbRequired: total > EWB_LIMIT, ewb: ewb || null };
};

// Returns the open draft challan of an order, creating it (pre-allocated from the reserved FIFO batches) if none exists.
const draftFor = async (soId) => {
  let [dc] = await q("SELECT id FROM challans WHERE so_id=? AND status='DRAFT' AND org_id=? LIMIT 1", [soId, ORG]);
  if (dc) return dc.id;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[so]] = await c.query("SELECT id,party_id,warehouse_id,status FROM sales_orders WHERE id=? AND org_id=? FOR UPDATE", [soId, ORG]);
    if (!so) throw bad("Order not found", 404);
    if (!["CONFIRMED", "PARTIAL"].includes(so.status)) throw bad("Only confirmed orders can be dispatched", 409);
    const [[again]] = await c.query("SELECT id FROM challans WHERE so_id=? AND status='DRAFT' LIMIT 1", [soId]);
    if (again) { await c.commit(); return again.id; }
    const no = await nextNo(c, "DC", "DC");
    const [ins] = await c.query("INSERT INTO challans (org_id,doc_no,so_id,party_id,warehouse_id,challan_date,status) VALUES (?,?,?,?,?,NOW(),'DRAFT')", [ORG, no, so.id, so.party_id, so.warehouse_id]);
    const [lines] = await c.query("SELECT * FROM sales_order_lines WHERE so_id=? AND warehouse_id=? ORDER BY line_no", [so.id, so.warehouse_id]);
    for (const l of lines) {
      const [bs] = await c.query(`SELECT b.id,${FREE_FOR_LINE} free FROM batches b WHERE b.item_id=? AND b.warehouse_id=? AND b.qty_on_hand>0
        AND (b.expiry_date IS NULL OR b.expiry_date>=CURDATE()) ORDER BY b.mfg_date,b.id`, [l.id, l.item_id, l.warehouse_id]);
      const room = bs.reduce((s, b) => s + Math.max(b.free, 0), 0);
      for (const [bid, qty] of Object.entries(fifo(bs, Math.min(r3(l.qty - l.qty_sent), room))))
        await c.query("INSERT INTO challan_lines (challan_id,so_line_id,item_id,batch_id,qty,rate) VALUES (?,?,?,?,?,?)", [ins.insertId, l.id, l.item_id, bid, qty, l.rate]);
    }
    await c.commit(); return ins.insertId;
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
};
r.get("/challans/for-so/:soId", async (req, res) => {   // create-or-get the open draft challan for an order
  try { res.json(await loadDC(await draftFor(req.params.soId))); } catch (e) { fail(res, e); }
});
r.post("/challans", async (req, res) => {
  try { const dc = await loadDC(await draftFor(Number(req.body?.so_id))); res.status(201).json(dc); } catch (e) { fail(res, e); }
});
r.get("/challans", async (req, res) => {
  const where = ["c.org_id=?"], params = [ORG];
  if (req.query.status) { where.push("c.status=?"); params.push(String(req.query.status).toUpperCase()); }
  if (req.query.so_id) { where.push("c.so_id=?"); params.push(Number(req.query.so_id)); }
  res.json({ rows: await q(`SELECT c.id,c.doc_no,c.so_id,s.doc_no so_no,c.status,c.challan_date,c.total,c.invoice_id,p.name customer,w.name godown
    FROM challans c JOIN parties p ON p.id=c.party_id JOIN warehouses w ON w.id=c.warehouse_id LEFT JOIN sales_orders s ON s.id=c.so_id
    WHERE ${where.join(" AND ")} ORDER BY c.id DESC LIMIT 100`, params) });
});
r.get("/challans/:id", async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();   // leave /challans/transit/current etc. to their own routes
  const d = await loadDC(req.params.id); d ? res.json(d) : res.status(404).json({ error: "Not found" });
});

r.put("/challans/:id", async (req, res) => {
  const { transport = {}, allocations = [] } = req.body || {};
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[dc]] = await c.query("SELECT id,status,so_id,warehouse_id FROM challans WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!dc) throw bad("Not found", 404);
    if (dc.status !== "DRAFT") throw bad("Challan already dispatched", 409);
    const want = allocations.filter((x) => +x.qty > 0);
    const perLine = new Map(), perBatch = new Map(), rows = [];
    for (const a of want) {
      const [[l]] = await c.query("SELECT id,item_id,rate,qty,qty_sent,warehouse_id FROM sales_order_lines WHERE id=? AND so_id=?", [a.so_line_id, dc.so_id]);
      if (!l) throw bad("Allocation refers to a line that is not on this order");
      if (l.warehouse_id !== dc.warehouse_id) throw bad("Line belongs to a different godown");
      const [[b]] = await c.query("SELECT id FROM batches WHERE id=? AND item_id=? AND warehouse_id=? FOR UPDATE", [a.batch_id, l.item_id, dc.warehouse_id]);
      if (!b) throw bad("Batch does not belong to this item and godown");
      const qty = r3(+a.qty);
      perLine.set(l.id, r3((perLine.get(l.id) || 0) + qty));
      if (perLine.get(l.id) > r3(l.qty - l.qty_sent) + EPS) throw bad("Dispatch cannot exceed the pending order quantity");
      const k = `${l.id}:${b.id}`; perBatch.set(k, r3((perBatch.get(k) || 0) + qty));
      rows.push([req.params.id, l.id, l.item_id, b.id, qty, l.rate, a.reason || null]);   // rate comes from the order line, not the client
    }
    for (const [k, qty] of perBatch) {
      const [lineId, batchId] = k.split(":");
      const [[b]] = await c.query(`SELECT ${FREE_FOR_LINE} free FROM batches b WHERE b.id=?`, [lineId, batchId]);
      if (qty > b.free + EPS) throw bad("Allocation exceeds free stock in batch");
    }
    await c.query("DELETE FROM challan_lines WHERE challan_id=?", [req.params.id]);
    for (const x of rows) await c.query("INSERT INTO challan_lines (challan_id,so_line_id,item_id,batch_id,qty,rate,override_reason) VALUES (?,?,?,?,?,?,?)", x);
    await c.query("UPDATE challans SET vehicle_no=?,distance_km=?,driver=?,driver_mobile=?,transporter=? WHERE id=?",
      [transport.vehicle_no, transport.distance_km || null, transport.driver, transport.driver_mobile, transport.transporter, req.params.id]);
    await c.commit(); res.json(await loadDC(req.params.id));
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

// Dispatch & post stock — one transaction. The challan row is locked and its status re-checked inside the
// transaction, so a retry or double-click can never issue the stock twice. E-way bill is idempotent too.
r.post("/challans/:id/dispatch", async (req, res) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[lock]] = await c.query("SELECT status FROM challans WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!lock) throw bad("Not found", 404);
    if (lock.status !== "DRAFT") throw bad("Challan is not a draft", 409);
    const dc = await loadDC(req.params.id);
    if (!dc.total) throw bad("Nothing allocated");
    if (!dc.vehicle_no) throw bad("Vehicle number is required");
    if (dc.ewbRequired && !req.body?.generateEwb) throw Object.assign(bad("An e-way bill is mandatory above ₹50,000"), { ewb: true });
    const [rows] = await c.query("SELECT * FROM challan_lines WHERE challan_id=? ORDER BY id", [dc.id]);
    const [sol] = await c.query("SELECT id,qty,qty_sent FROM sales_order_lines WHERE so_id=? FOR UPDATE", [dc.so_id]);
    const sum = new Map();
    for (const a of rows) if (a.so_line_id) sum.set(a.so_line_id, r3((sum.get(a.so_line_id) || 0) + a.qty));
    for (const [id, qty] of sum) { const l = sol.find((x) => x.id === id); if (!l || r3(l.qty_sent + qty) > l.qty + EPS) throw bad("Dispatch cannot exceed the ordered quantity", 409); }
    for (const a of rows) {
      const [[b]] = await c.query("SELECT qty_on_hand FROM batches WHERE id=? FOR UPDATE", [a.batch_id]);
      if (b.qty_on_hand < a.qty) throw bad("Stock changed — reload the challan", 409);
      if (a.so_line_id) await consumeReservation(c, a.so_line_id, a.qty);
      await c.query("UPDATE batches SET qty_on_hand=qty_on_hand-? WHERE id=?", [a.qty, a.batch_id]);
      const [[after]] = await c.query("SELECT qty_on_hand,qty_reserved FROM batches WHERE id=?", [a.batch_id]);
      if (after.qty_on_hand + EPS < after.qty_reserved) throw bad("Stock changed — the rest of this batch is reserved for other orders", 409);
      await c.query("INSERT INTO stock_ledger (org_id,warehouse_id,item_id,batch_id,doc_no,movement,qty,value,reason) VALUES (?,?,?,?,?, 'DC_ISSUE',?,?,?)",
        [ORG, dc.warehouse_id, a.item_id, a.batch_id, dc.doc_no, -a.qty, round(a.qty * a.rate), a.override_reason]);
      if (a.so_line_id) await c.query("UPDATE sales_order_lines SET qty_sent=qty_sent+? WHERE id=?", [a.qty, a.so_line_id]);
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
  } catch (e) { await c.rollback(); e.ewb ? res.status(422).json({ error: e.message, code: "EWB_REQUIRED" }) : fail(res, e); } finally { c.release(); }
});

// Cancel a draft challan (no stock has moved yet). Dispatched challans are not reversed here.
r.post("/challans/:id/cancel", async (req, res) => {
  const [dc] = await q("SELECT status FROM challans WHERE id=? AND org_id=?", [req.params.id, ORG]);
  if (!dc) return res.status(404).json({ error: "Not found" });
  const out = await q("UPDATE challans SET status='CANCELLED' WHERE id=? AND status='DRAFT'", [req.params.id]);
  if (!out.affectedRows) return res.status(409).json({ error: "Only a draft challan can be cancelled; a dispatched challan needs a sales return" });
  res.json({ ok: true });
});

export default r;
