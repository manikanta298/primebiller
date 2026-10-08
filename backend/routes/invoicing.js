import { Router } from "express";
import { pool, q } from "../db.js";
import { nextDocNo, peekDocNo } from "../services/sales/docNo.js";
import { calcLine, round } from "./sales.js";
import { ORG } from "../org.js";

const r = Router();
const EPS = 0.005;
const fail = (res, e) => res.status(Number.isInteger(e.code) ? e.code : 500).json({ error: e.message });
const bad = (msg, code = 422) => Object.assign(new Error(msg), { code });
export const invoiceStatus = (total, balance) => (balance <= EPS ? "PAID" : balance < total - EPS ? "PARTIALLY_PAID" : "ISSUED");

// CGST+SGST inside the organisation's state, IGST outside it (a party without GSTIN is treated as local).
const isIntra = async (exec, partyId) => {
  const [[p]] = await exec("SELECT gstin FROM parties WHERE id=? AND org_id=?", [partyId, ORG]);
  const [[o]] = await exec("SELECT state_code FROM organizations WHERE id=?", [ORG]);
  return !p?.gstin || p.gstin.slice(0, 2) === String(o?.state_code || "36");
};
const split = (tax, intra) => ({ cgst: intra ? round(tax / 2) : 0, sgst: intra ? round(tax / 2) : 0, igst: intra ? 0 : round(tax) });

// Per-rate tax summary, recalculated server-side from the challan lines (quantity x order rate, less the
// order-line discount, GST rate from the item master). Every rate present is returned, not only 5/18/28.
const summarise = async (ids, exec = async (s, p) => (await q(s, p)), intra = true) => {
  const empty = { rates: [], taxable: 0, tax: 0, total: 0, cgst: 0, sgst: 0, igst: 0 };
  if (!ids.length) return empty;
  const rows = await exec(`SELECT i.gst_rate rate,cl.qty,cl.rate price,COALESCE(sl.disc_pct,0) disc FROM challan_lines cl JOIN items i ON i.id=cl.item_id
    LEFT JOIN sales_order_lines sl ON sl.id=cl.so_line_id WHERE cl.challan_id IN (?)`, [ids]);
  const by = new Map([[5, 0], [18, 0], [28, 0]]);
  for (const x of rows) by.set(+x.rate, round((by.get(+x.rate) || 0) + calcLine({ qty: x.qty, rate: x.price, disc_pct: x.disc, gst_pct: x.rate }).taxable));
  const rates = [...by].map(([rate, t]) => ({ rate, taxable: t, tax: round(t * rate / 100) })).sort((a, b) => b.rate - a.rate);
  const taxable = round(rates.reduce((a, x) => a + x.taxable, 0)), tax = round(rates.reduce((a, x) => a + x.tax, 0));
  return { rates, taxable, tax, total: round(taxable + tax), ...split(tax, intra) };
};

r.get("/invoicing/context", async (_q, res) => {
  const [party] = await q(`SELECT DISTINCT p.id,p.name,p.gstin FROM challans c JOIN parties p ON p.id=c.party_id WHERE c.org_id=? AND c.status='DELIVERED' AND c.invoice_id IS NULL ORDER BY p.id LIMIT 1`, [ORG]);
  if (!party) return res.json(null);
  const challans = await q(`SELECT c.id,c.doc_no,c.challan_date,c.total,w.name godown,
      (SELECT COUNT(*) FROM challan_lines WHERE challan_id=c.id) AS \`lines\`, c.pod_signed
    FROM challans c JOIN warehouses w ON w.id=c.warehouse_id WHERE c.party_id=? AND c.status IN ('DELIVERED','IN_TRANSIT') AND c.invoice_id IS NULL ORDER BY c.challan_date DESC`, [party.id]);
  const advances = await q("SELECT id,doc_no,receipt_date,mode,unadjusted FROM receipts WHERE party_id=? AND status='POSTED' AND unadjusted>0 ORDER BY receipt_date", [party.id]);
  res.json({ party, challans, advances, nextNo: await peekDocNo("INV", "INV"), available: advances.reduce((a, x) => a + x.unadjusted, 0) });
});

r.post("/invoicing/preview", async (req, res) => {
  const { challanIds = [], advances = [] } = req.body || {};
  let partyId = req.body?.partyId;
  if (!partyId && challanIds.length) partyId = (await q("SELECT party_id FROM challans WHERE id=? AND org_id=?", [challanIds[0], ORG]))[0]?.party_id;
  const s = await summarise(challanIds, undefined, partyId ? await isIntra(async (a, b) => [await q(a, b)], partyId) : true);
  const applied = round(Math.min(s.total, advances.reduce((a, x) => a + (+x.amount || 0), 0)));
  res.json({ ...s, advanceAdjusted: applied, balanceDue: round(s.total - applied) });
});

// Issues one invoice for dispatched challans of a party: numbering, allocations and challan links post in ONE
// transaction. A challan can be billed once, so billed quantity can never exceed what was dispatched.
const issueInvoice = async (partyId, rawIds, advances = []) => {
  const challanIds = [...new Set(rawIds.map(Number))];
  if (!challanIds.length || challanIds.some((n) => !Number.isInteger(n) || n < 1)) throw bad("Select at least one challan");
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const exec = async (s, p) => (await c.query(s, p))[0];
    const found = await exec("SELECT id,so_id,warehouse_id,status,invoice_id FROM challans WHERE id IN (?) AND party_id=? AND org_id=? FOR UPDATE", [challanIds, partyId, ORG]);
    if (found.length !== challanIds.length) throw bad("A selected challan was not found for this customer", 404);
    if (found.some((x) => x.invoice_id || x.status === "INVOICED")) throw bad("A selected challan is already invoiced", 409);
    if (found.some((x) => !["IN_TRANSIT", "DELIVERED"].includes(x.status))) throw bad("Only dispatched challans can be invoiced", 409);
    const s = await summarise(challanIds, exec, await isIntra(c.query.bind(c), partyId));
    if (!(s.total > 0)) throw bad("The selected challans have nothing to bill");
    const docNo = await nextDocNo(c, "INV", "INV");
    let applied = 0; const use = [];
    for (const a of advances.filter((x) => +x.amount > 0)) {
      const [[rc]] = await c.query("SELECT unadjusted FROM receipts WHERE id=? AND party_id=? AND org_id=? AND status='POSTED' FOR UPDATE", [a.receiptId, partyId, ORG]);
      const amt = round(Math.min(+a.amount, rc?.unadjusted || 0, s.total - applied));
      if (amt > 0) { applied = round(applied + amt); use.push([a.receiptId, amt]); }
    }
    const balance = round(s.total - applied);
    const sos = [...new Set(found.map((x) => x.so_id).filter(Boolean))], whs = [...new Set(found.map((x) => x.warehouse_id))];
    const [inv] = await c.query(`INSERT INTO invoices (org_id,doc_no,party_id,warehouse_id,so_id,invoice_date,due_date,taxable,cgst,sgst,igst,total,advance_adjusted,balance_due,status)
      VALUES (?,?,?,?,?,CURDATE(),CURDATE()+INTERVAL 30 DAY,?,?,?,?,?,?,?,?)`,
      [ORG, docNo, partyId, whs.length === 1 ? whs[0] : null, sos.length === 1 ? sos[0] : null, s.taxable, s.cgst, s.sgst, s.igst, s.total, applied, balance, invoiceStatus(s.total, balance)]);
    for (const [rid, amt] of use) {
      await c.query("INSERT INTO receipt_allocations (receipt_id,invoice_id,amount) VALUES (?,?,?)", [rid, inv.insertId, amt]);
      await c.query("UPDATE receipts SET unadjusted=unadjusted-? WHERE id=?", [amt, rid]);
    }
    await c.query("UPDATE challans SET status='INVOICED',invoice_id=? WHERE id IN (?)", [inv.insertId, challanIds]);
    if (sos.length) await c.query(`UPDATE sales_orders s SET status='INVOICED' WHERE s.id IN (?) AND s.status='DELIVERED'
      AND NOT EXISTS (SELECT 1 FROM challans k WHERE k.so_id=s.id AND k.status NOT IN ('INVOICED','CANCELLED'))`, [sos]);
    await c.commit();
    return { id: inv.insertId, docNo, ...s, advanceAdjusted: applied, balanceDue: balance, status: invoiceStatus(s.total, balance) };
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
};

r.post("/invoices", async (req, res) => {
  const { partyId, challanIds = [], advances = [] } = req.body || {};
  try { res.status(201).json(await issueInvoice(partyId, challanIds, advances)); } catch (e) { fail(res, e); }
});
r.post("/invoices/from-challan/:id", async (req, res) => {
  const [dc] = await q("SELECT party_id FROM challans WHERE id=? AND org_id=?", [req.params.id, ORG]);
  if (!dc) return res.status(404).json({ error: "Challan not found" });
  try { res.status(201).json(await issueInvoice(dc.party_id, [req.params.id], req.body?.advances || [])); } catch (e) { fail(res, e); }
});

r.get("/invoices", async (req, res) => {
  const where = ["i.org_id=?"], params = [ORG];
  if (req.query.status) { where.push("i.status=?"); params.push(String(req.query.status).toUpperCase()); }
  if (req.query.party_id) { where.push("i.party_id=?"); params.push(Number(req.query.party_id)); }
  res.json({ rows: await q(`SELECT i.id,i.doc_no,i.invoice_date,i.due_date,i.status,i.total,i.advance_adjusted,i.balance_due,i.total-i.balance_due paid,p.name customer
    FROM invoices i JOIN parties p ON p.id=i.party_id WHERE ${where.join(" AND ")} ORDER BY i.id DESC LIMIT 100`, params) });
});

r.get("/invoices/:id", async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const [inv] = await q("SELECT i.*,p.name customer,p.gstin FROM invoices i JOIN parties p ON p.id=i.party_id WHERE i.id=? AND i.org_id=?", [req.params.id, ORG]);
  if (!inv) return res.status(404).json({ error: "Not found" });
  const challans = await q("SELECT id,doc_no,challan_date FROM challans WHERE invoice_id=? ORDER BY id", [inv.id]);
  const [so] = inv.so_id ? await q("SELECT id,doc_no FROM sales_orders WHERE id=?", [inv.so_id]) : [];
  const lines = (await q(`SELECT i.name,i.hsn,i.base_uom uom,i.gst_rate,SUM(cl.qty) qty,cl.rate,COALESCE(sl.disc_pct,0) disc_pct
    FROM challan_lines cl JOIN challans c ON c.id=cl.challan_id JOIN items i ON i.id=cl.item_id LEFT JOIN sales_order_lines sl ON sl.id=cl.so_line_id
    WHERE c.invoice_id=? GROUP BY i.id,cl.rate,sl.disc_pct,i.gst_rate ORDER BY i.name`, [inv.id]))
    .map((l) => ({ ...l, taxable: calcLine({ qty: l.qty, rate: l.rate, disc_pct: l.disc_pct, gst_pct: l.gst_rate }).taxable }));
  const receipts = await q(`SELECT r.id,r.doc_no,r.receipt_date,r.mode,r.reference,r.status,a.amount FROM receipt_allocations a JOIN receipts r ON r.id=a.receipt_id WHERE a.invoice_id=? ORDER BY r.id`, [inv.id]);
  res.json({ ...inv, paid: round(inv.total - inv.balance_due), so: so || null, challans, lines, receipts, tax: round(inv.cgst + inv.sgst + inv.igst) });
});

// Only the due date can change after issue; amounts are fixed by the delivered challans.
r.put("/invoices/:id", async (req, res) => {
  const due = String(req.body?.due_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due))) return res.status(422).json({ error: "A valid due date is required" });
  const out = await q("UPDATE invoices SET due_date=? WHERE id=? AND org_id=? AND status<>'CANCELLED' AND due_date IS NOT NULL", [due, req.params.id, ORG]);
  if (!out.affectedRows) return res.status(409).json({ error: "Invoice not found or cancelled" });
  res.json({ ok: true });
});

// Cancel an invoice that has received no payment (advances applied at issue are handed back). The challans become billable again.
r.post("/invoices/:id/cancel", async (req, res) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[inv]] = await c.query("SELECT id,so_id,total,balance_due,advance_adjusted,status FROM invoices WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!inv) throw bad("Not found", 404);
    if (inv.status === "CANCELLED") throw bad("Invoice is already cancelled", 409);
    if (round(inv.total - inv.balance_due - inv.advance_adjusted) > EPS) throw bad("Payments are recorded against this invoice; cancel those receipts first", 409);
    const [al] = await c.query("SELECT receipt_id,amount FROM receipt_allocations WHERE invoice_id=?", [inv.id]);
    for (const a of al) await c.query("UPDATE receipts SET unadjusted=unadjusted+? WHERE id=?", [a.amount, a.receipt_id]);
    await c.query("DELETE FROM receipt_allocations WHERE invoice_id=?", [inv.id]);
    await c.query("UPDATE challans SET status=IF(pod_signed=1,'DELIVERED','IN_TRANSIT'),invoice_id=NULL WHERE invoice_id=?", [inv.id]);
    if (inv.so_id) await c.query("UPDATE sales_orders SET status='DELIVERED' WHERE id=? AND status='INVOICED'", [inv.so_id]);
    await c.query("UPDATE invoices SET status='CANCELLED',balance_due=0 WHERE id=?", [inv.id]);
    await c.commit(); res.json({ ok: true });
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

// ---------- In-transit challan ----------
r.get("/challans/transit/current", async (_q, res) => res.json((await q("SELECT id FROM challans WHERE doc_no='DC/25-26/00118'"))[0] || null));

r.get("/challans/:id/transit", async (req, res) => {
  const [dc] = await q(`SELECT c.*,p.name customer,s.ship_to FROM challans c JOIN parties p ON p.id=c.party_id LEFT JOIN sales_orders s ON s.id=c.so_id WHERE c.id=?`, [req.params.id]);
  if (!dc) return res.status(404).json({ error: "Not found" });
  const events = await q("SELECT event,note,at FROM challan_events WHERE challan_id=? ORDER BY at,id", [dc.id]);
  const [ewb] = await q("SELECT * FROM eway_bills WHERE challan_id=?", [dc.id]);
  const items = await q(`SELECT i.name,b.batch_no,cl.qty,i.base_uom uom,cl.batch_id FROM challan_lines cl JOIN items i ON i.id=cl.item_id LEFT JOIN batches b ON b.id=cl.batch_id WHERE cl.challan_id=?`, [dc.id]);
  const s = await summarise([dc.id]);
  res.json({ ...dc, events, ewb: ewb || null, items, taxable: s.taxable || dc.taxable, tax: s.tax || dc.tax });
});

const log = (id, event, note) => q("INSERT INTO challan_events (challan_id,event,note) VALUES (?,?,?)", [id, event, note]);
r.post("/challans/:id/ewb/extend", async (req, res) => {
  await q("UPDATE eway_bills SET valid_until=valid_until+INTERVAL 1 DAY,gsp_log='extension · 200 OK' WHERE challan_id=? AND status='ACTIVE'", [req.params.id]);
  await log(req.params.id, "E-way bill validity extended", "+1 day"); res.json({ ok: true });
});
r.post("/challans/:id/ewb/part-b", async (req, res) => {
  await q("UPDATE eway_bills SET vehicle_no=? WHERE challan_id=? AND status='ACTIVE'", [req.body.vehicle_no, req.params.id]);
  await q("UPDATE challans SET vehicle_no=? WHERE id=?", [req.body.vehicle_no, req.params.id]);
  await log(req.params.id, "Part-B updated", req.body.vehicle_no); res.json({ ok: true });
});
r.post("/challans/:id/ewb/cancel", async (req, res) => {
  const [e] = await q("SELECT created_at FROM (SELECT at created_at FROM challan_events WHERE challan_id=? AND event='E-way bill generated') x", [req.params.id]);
  if (e && Date.now() - new Date(e.created_at).getTime() > 864e5) return res.status(409).json({ error: "Cancellation window (24 h) has passed" });
  await q("UPDATE eway_bills SET status='CANCELLED' WHERE challan_id=?", [req.params.id]);
  await log(req.params.id, "E-way bill cancelled", "by user"); res.json({ ok: true });
});
const markDelivered = async (req, res) => {
  const out = await q("UPDATE challans SET status='DELIVERED',pod_signed=1 WHERE id=? AND org_id=? AND status='IN_TRANSIT'", [req.params.id, ORG]);
  if (!out.affectedRows) return res.status(409).json({ error: "Only a challan that is in transit can be marked delivered" });
  await log(req.params.id, "Proof of delivery", "marked delivered"); res.json({ ok: true });
};
r.post("/challans/:id/mark-delivered", markDelivered);
r.post("/challans/:id/deliver", markDelivered);

export default r;
