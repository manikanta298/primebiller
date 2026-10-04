import { Router } from "express";
import { pool, q } from "../db.js";

const r = Router();
import { ORG } from "../org.js";
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Per-rate tax summary for a set of challans (taxable = qty × rate, GST from the item master)
const summarise = async (ids, exec = q) => {
  if (!ids.length) return { rates: [], taxable: 0, tax: 0, total: 0 };
  const rows = await exec(`SELECT i.gst_rate rate, SUM(cl.qty*cl.rate) taxable FROM challan_lines cl JOIN items i ON i.id=cl.item_id
    WHERE cl.challan_id IN (?) GROUP BY i.gst_rate`, [ids]);
  const rates = [5, 18, 28].map((k) => { const t = round(rows.find((x) => +x.rate === k)?.taxable || 0); return { rate: k, taxable: t, tax: round(t * k / 100) }; });
  const taxable = round(rates.reduce((a, x) => a + x.taxable, 0)), tax = round(rates.reduce((a, x) => a + x.tax, 0));
  return { rates: rates.sort((a, b) => b.rate - a.rate), taxable, tax, total: round(taxable + tax) };
};

r.get("/invoicing/context", async (_q, res) => {
  const [party] = await q(`SELECT DISTINCT p.id,p.name,p.gstin FROM challans c JOIN parties p ON p.id=c.party_id WHERE c.status='DELIVERED' AND c.invoice_id IS NULL ORDER BY p.id LIMIT 1`);
  if (!party) return res.json(null);
  const challans = await q(`SELECT c.id,c.doc_no,c.challan_date,c.total,w.name godown,
      (SELECT COUNT(*) FROM challan_lines WHERE challan_id=c.id) AS \`lines\`, c.pod_signed
    FROM challans c JOIN warehouses w ON w.id=c.warehouse_id WHERE c.party_id=? AND c.status IN ('DELIVERED','IN_TRANSIT') AND c.invoice_id IS NULL ORDER BY c.challan_date DESC`, [party.id]);
  const advances = await q("SELECT id,doc_no,receipt_date,mode,unadjusted FROM receipts WHERE party_id=? AND unadjusted>0 ORDER BY receipt_date", [party.id]);
  const [{ last_no }] = await q("SELECT last_no FROM doc_counters WHERE org_id=? AND doc_type='INV' AND fy='25-26'", [ORG]);
  res.json({ party, challans, advances, nextNo: `INV/25-26/${String(last_no + 1).padStart(5, "0")}`,
    available: advances.reduce((a, x) => a + x.unadjusted, 0) });
});

r.post("/invoicing/preview", async (req, res) => {
  const { challanIds = [], advances = [] } = req.body;
  const s = await summarise(challanIds);
  const applied = round(Math.min(s.total, advances.reduce((a, x) => a + (+x.amount || 0), 0)));
  res.json({ ...s, cgst: round(s.tax / 2), sgst: round(s.tax / 2), advanceAdjusted: applied, balanceDue: round(s.total - applied) });
});

// Issue: number, journal-side effects, allocations and challan links post in ONE transaction
r.post("/invoices", async (req, res) => {
  const { partyId, challanIds = [], advances = [] } = req.body;
  if (!challanIds.length) return res.status(422).json({ error: "Select at least one challan" });
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const exec = async (s, p) => (await c.query(s, p))[0];
    const ok = await exec("SELECT id FROM challans WHERE id IN (?) AND party_id=? AND invoice_id IS NULL FOR UPDATE", [challanIds, partyId]);
    if (ok.length !== challanIds.length) throw Object.assign(new Error("A selected challan is already invoiced"), { code: 409 });
    const s = await summarise(challanIds, exec);
    const [[cnt]] = await c.query("SELECT last_no FROM doc_counters WHERE org_id=? AND doc_type='INV' AND fy='25-26' FOR UPDATE", [ORG]);   // locked counter row => gapless
    const n = cnt.last_no + 1, docNo = `INV/25-26/${String(n).padStart(5, "0")}`;
    await c.query("UPDATE doc_counters SET last_no=? WHERE org_id=? AND doc_type='INV' AND fy='25-26'", [n, ORG]);
    let applied = 0; const use = [];
    for (const a of advances.filter((x) => +x.amount > 0)) {
      const [[rc]] = await c.query("SELECT unadjusted FROM receipts WHERE id=? AND party_id=? FOR UPDATE", [a.receiptId, partyId]);
      const amt = round(Math.min(+a.amount, rc?.unadjusted || 0, s.total - applied)); if (amt > 0) { applied = round(applied + amt); use.push([a.receiptId, amt]); }
    }
    const [inv] = await c.query(`INSERT INTO invoices (org_id,doc_no,party_id,invoice_date,due_date,taxable,cgst,sgst,total,advance_adjusted,balance_due)
      VALUES (?,?,?,CURDATE(),CURDATE()+INTERVAL 30 DAY,?,?,?,?,?,?)`, [ORG, docNo, partyId, s.taxable, s.tax / 2, s.tax / 2, s.total, applied, round(s.total - applied)]);
    for (const [rid, amt] of use) {
      await c.query("INSERT INTO receipt_allocations (receipt_id,invoice_id,amount) VALUES (?,?,?)", [rid, inv.insertId, amt]);
      await c.query("UPDATE receipts SET unadjusted=unadjusted-? WHERE id=?", [amt, rid]);
    }
    await c.query("UPDATE challans SET status='INVOICED',invoice_id=? WHERE id IN (?)", [inv.insertId, challanIds]);
    await c.commit(); res.json({ id: inv.insertId, docNo, ...s, advanceAdjusted: applied, balanceDue: round(s.total - applied) });
  } catch (e) { await c.rollback(); res.status(e.code || 500).json({ error: e.message }); } finally { c.release(); }
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
r.post("/challans/:id/mark-delivered", async (req, res) => {
  await q("UPDATE challans SET status='DELIVERED',pod_signed=1 WHERE id=? AND status='IN_TRANSIT'", [req.params.id]);
  await log(req.params.id, "Proof of delivery", "marked delivered"); res.json({ ok: true });
});

export default r;
