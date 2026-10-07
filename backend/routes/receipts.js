import { Router } from "express";
import { pool, q } from "../db.js";
import { nextDocNo } from "../services/sales/docNo.js";
import { round } from "./sales.js";
import { invoiceStatus } from "./invoicing.js";
import { ORG } from "../org.js";

const r = Router();
const EPS = 0.005;
const MODES = ["NEFT", "Cheque", "Cash", "UPI"];
const fail = (res, e) => res.status(Number.isInteger(e.code) ? e.code : 500).json({ error: e.message });
const bad = (msg, code = 422) => Object.assign(new Error(msg), { code });
const money = (v) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0 || n > 1e11) throw bad("Amounts must be positive numbers"); return round(n); };

// Applies part of a receipt's unadjusted money to invoices. Each invoice is locked, so an allocation can
// never exceed what is still owed, and the invoice's balance and status move in the same transaction.
const allocate = async (c, receipt, list) => {
  const merged = new Map();
  for (const a of list || []) { const id = Number(a.invoice_id); if (!Number.isInteger(id) || id < 1) throw bad("Select a valid invoice"); merged.set(id, round((merged.get(id) || 0) + money(a.amount))); }
  const total = round([...merged.values()].reduce((s, x) => s + x, 0));
  if (total > receipt.unadjusted + EPS) throw bad("Allocations exceed the unapplied amount of this receipt");
  for (const [id, amt] of merged) {
    const [[inv]] = await c.query("SELECT id,party_id,total,balance_due,status FROM invoices WHERE id=? AND org_id=? FOR UPDATE", [id, ORG]);
    if (!inv || inv.party_id !== receipt.party_id) throw bad("Invoice not found for this customer", 404);
    if (inv.status === "CANCELLED") throw bad("A cancelled invoice cannot receive payment", 409);
    if (amt > inv.balance_due + EPS) throw bad("Allocation exceeds the invoice balance");
    const bal = round(inv.balance_due - amt);
    await c.query("INSERT INTO receipt_allocations (receipt_id,invoice_id,amount) VALUES (?,?,?)", [receipt.id, id, amt]);
    await c.query("UPDATE invoices SET balance_due=?,status=? WHERE id=?", [bal, invoiceStatus(inv.total, bal), id]);
  }
  await c.query("UPDATE receipts SET unadjusted=unadjusted-? WHERE id=?", [total, receipt.id]);
  return total;
};

const detail = async (id) => {
  const [rc] = await q("SELECT r.*,p.name customer FROM receipts r JOIN parties p ON p.id=r.party_id WHERE r.id=? AND r.org_id=?", [id, ORG]);
  if (!rc) return null;
  const allocations = await q("SELECT a.invoice_id,i.doc_no invoice_no,a.amount FROM receipt_allocations a JOIN invoices i ON i.id=a.invoice_id WHERE a.receipt_id=? ORDER BY a.id", [id]);
  return { ...rc, allocations, applied: round(rc.amount - rc.unadjusted), is_advance: rc.unadjusted > EPS };
};

// Post a receipt: money against invoices, any remainder stays as an unapplied advance.
r.post("/receipts", async (req, res) => {
  const b = req.body || {};
  const c = await pool.getConnection();
  try {
    const amount = money(b.amount);
    if (!MODES.includes(b.mode)) throw bad(`Payment mode must be one of ${MODES.join(", ")}`);
    const date = b.receipt_date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw bad("Receipt date is not valid");
    await c.beginTransaction();
    const [[p]] = await c.query("SELECT id FROM parties WHERE id=? AND org_id=? AND party_type='CUSTOMER'", [b.party_id, ORG]);
    if (!p) throw bad("Select a valid customer");
    const no = await nextDocNo(c, "RCT", "RCT");
    const [ins] = await c.query("INSERT INTO receipts (org_id,doc_no,party_id,receipt_date,mode,amount,unadjusted,status,reference) VALUES (?,?,?,?,?,?,?,'POSTED',?)",
      [ORG, no, p.id, date, b.mode, amount, amount, b.reference ? String(b.reference).slice(0, 60) : null]);
    await allocate(c, { id: ins.insertId, party_id: p.id, unadjusted: amount }, b.allocations);
    await c.commit(); res.status(201).json(await detail(ins.insertId));
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

r.get("/receipts", async (req, res) => {
  const where = ["r.org_id=?"], params = [ORG];
  if (req.query.status) { where.push("r.status=?"); params.push(String(req.query.status).toUpperCase()); }
  if (req.query.party_id) { where.push("r.party_id=?"); params.push(Number(req.query.party_id)); }
  if (req.query.unapplied) where.push("r.unadjusted>0 AND r.status='POSTED'");
  res.json({ rows: await q(`SELECT r.id,r.doc_no,r.receipt_date,r.mode,r.reference,r.status,r.amount,r.unadjusted,p.name customer
    FROM receipts r JOIN parties p ON p.id=r.party_id WHERE ${where.join(" AND ")} ORDER BY r.id DESC LIMIT 100`, params) });
});
r.get("/receipts/:id", async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();   // leave /receipts/list to its own route
  const d = await detail(req.params.id); d ? res.json(d) : res.status(404).json({ error: "Not found" });
});

// Link an advance (or the unapplied rest of any receipt) to invoices later.
r.post("/receipts/:id/allocate", async (req, res) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[rc]] = await c.query("SELECT id,party_id,unadjusted,status FROM receipts WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!rc) throw bad("Not found", 404);
    if (rc.status !== "POSTED") throw bad("Only a posted receipt can be allocated", 409);
    if (!(req.body?.allocations || []).length) throw bad("Select at least one invoice");
    await allocate(c, rc, req.body.allocations);
    await c.commit(); res.json(await detail(rc.id));
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

// Cancel a posted receipt: every allocation is reversed onto its invoice (balance and status restored).
r.post("/receipts/:id/cancel", async (req, res) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[rc]] = await c.query("SELECT id,status FROM receipts WHERE id=? AND org_id=? FOR UPDATE", [req.params.id, ORG]);
    if (!rc) throw bad("Not found", 404);
    if (rc.status !== "POSTED") throw bad("Receipt is already cancelled", 409);
    const [al] = await c.query("SELECT invoice_id,SUM(amount) amount FROM receipt_allocations WHERE receipt_id=? GROUP BY invoice_id", [rc.id]);
    for (const a of al) {
      const [[inv]] = await c.query("SELECT total,balance_due FROM invoices WHERE id=? FOR UPDATE", [a.invoice_id]);
      const bal = round(Math.min(inv.total, inv.balance_due + a.amount));
      await c.query("UPDATE invoices SET balance_due=?,status=? WHERE id=?", [bal, invoiceStatus(inv.total, bal), a.invoice_id]);
    }
    await c.query("DELETE FROM receipt_allocations WHERE receipt_id=?", [rc.id]);
    await c.query("UPDATE receipts SET status='CANCELLED',unadjusted=0 WHERE id=?", [rc.id]);
    await c.commit(); res.json(await detail(rc.id));
  } catch (e) { await c.rollback(); fail(res, e); } finally { c.release(); }
});

export default r;
