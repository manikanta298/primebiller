import { peekDocNo } from "../services/sales/docNo.js";
import { Router } from "express";
import express from "express";
import { pool, q } from "../db.js";
import { KINDS, validateRow, parseCsv, suggestUom, inrWords } from "../importer.js";

const r = Router();
import { ORG } from "../org.js";
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------- Item detail (Batches tab) ----------
r.get("/items/current", async (_q, res) => res.json((await q("SELECT id FROM items WHERE sku='CEM-UT-PPC-50'"))[0] || null));
r.get("/items/:id/detail", async (req, res) => {
  const [item] = await q("SELECT * FROM items WHERE id=?", [req.params.id]);
  if (!item) return res.status(404).json({ error: "Not found" });
  const batches = await q(`SELECT b.*,w.name godown,DATEDIFF(CURDATE(),b.mfg_date) age,qty_on_hand-qty_reserved free,
      (expiry_date<CURDATE()) expired,(expiry_date BETWEEN CURDATE() AND CURDATE()+INTERVAL 45 DAY) near
    FROM batches b JOIN warehouses w ON w.id=b.warehouse_id WHERE b.item_id=? AND b.qty_on_hand>0 ORDER BY b.mfg_date,b.id`, [item.id]);
  const fifoId = batches.find((b) => !b.expired && b.free > 0)?.id;
  const [k] = await q("SELECT COALESCE(SUM(qty_on_hand),0) on_hand,COALESCE(SUM(qty_reserved),0) reserved,COALESCE(SUM(qty_on_hand*unit_cost),0) valuation FROM batches WHERE item_id=?", [item.id]);
  const [run] = await q("SELECT COALESCE(-SUM(qty),0)/30 daily FROM stock_ledger WHERE item_id=? AND qty<0 AND posted_at>NOW()-INTERVAL 30 DAY", [item.id]);
  res.json({ item,
    kpis: { ...k, free: k.on_hand - k.reserved, wavg: k.on_hand ? round(k.valuation / k.on_hand) : 0, cover: run.daily > 0 ? Math.round(k.on_hand / run.daily) : null, godowns: new Set(batches.map((b) => b.warehouse_id)).size },
    batches: batches.map((b) => ({ ...b, tag: b.expired ? "Expired" : b.id === fifoId ? "FIFO next" : b.near ? "Near expiry" : b.age > 180 ? "Over-aged" : null })),
    uoms: await q("SELECT uom,formula,to_base FROM item_uoms WHERE item_id=?", [item.id]),
    settings: await q("SELECT w.name godown,s.reorder_point reorder,s.max_qty max,w.allow_negative FROM item_warehouse_settings s JOIN warehouses w ON w.id=s.warehouse_id WHERE s.item_id=?", [item.id]) });
});

// ---------- Bulk import ----------
const summary = async (id) => {
  const [job] = await q("SELECT * FROM import_jobs WHERE id=?", [id]); if (!job) return null;
  const [c] = await q(`SELECT COUNT(*) total,SUM(error_kind IS NULL) valid,SUM(error_kind IS NOT NULL) errors,SUM(fixed) fixed,
      SUM(error_kind IS NOT NULL AND fixed=0) remaining FROM import_rows WHERE job_id=?`, [id]);
  const kinds = await q("SELECT error_kind kind,COUNT(*) AS `rows` FROM import_rows WHERE job_id=? AND error_kind IS NOT NULL GROUP BY error_kind ORDER BY `rows` DESC", [id]);
  return { job, counts: c, kinds: kinds.map((k) => ({ ...k, label: KINDS[k.kind] })) };
};
r.get("/imports/current", async (_q, res) => { const [j] = await q("SELECT id FROM import_jobs ORDER BY id DESC LIMIT 1"); res.json(j ? await summary(j.id) : null); });
r.get("/imports/:id", async (req, res) => res.json(await summary(req.params.id)));
r.get("/imports/:id/rows", async (req, res) => {
  const only = req.query.errorsOnly !== "0";
  res.json(await q(`SELECT row_no,payload,error_kind,error_msg,fixed FROM import_rows WHERE job_id=? ${only ? "AND error_kind IS NOT NULL AND fixed=0" : ""} ORDER BY row_no LIMIT 50 OFFSET ?`, [req.params.id, Number(req.query.cursor || 0)]));
});

const gnames = async () => (await q("SELECT name FROM warehouses WHERE org_id=?", [ORG])).flatMap((g) => [g.name, g.name.split(" ")[0]]);
r.patch("/imports/:id/rows/:no", async (req, res) => {
  const [row] = await q("SELECT payload FROM import_rows WHERE job_id=? AND row_no=?", [req.params.id, req.params.no]);
  if (!row) return res.status(404).json({ error: "Row not found" });
  const p = { ...JSON.parse(typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload)), [req.body.field]: req.body.value };
  const bad = validateRow(p, { godowns: await gnames() });
  if (bad?.kind && bad.kind !== "DUP") return res.status(422).json({ error: bad.msg });
  await q("UPDATE import_rows SET payload=?,fixed=1 WHERE job_id=? AND row_no=?", [JSON.stringify(p), req.params.id, req.params.no]);
  res.json(await summary(req.params.id));
});
r.post("/imports/:id/bulk-fix", async (req, res) => {
  const { kind } = req.body; const id = req.params.id;
  const rows = await q("SELECT row_no,payload FROM import_rows WHERE job_id=? AND error_kind=? AND fixed=0", [id, kind]);
  for (const x of rows) {
    const p = typeof x.payload === "string" ? JSON.parse(x.payload) : x.payload;
    if (kind === "UOM") { const s = suggestUom(p.uom); if (!s) continue; p.uom = s; }
    else if (kind === "HSN") p.hsn = String(p.hsn).padStart(4, "0");
    else if (kind === "DUP") p.skip = true;
    else continue;
    await q("UPDATE import_rows SET payload=?,fixed=1 WHERE job_id=? AND row_no=?", [JSON.stringify(p), id, x.row_no]);
  }
  res.json(await summary(id));
});
r.post("/imports/:id/cancel", async (req, res) => { await q("UPDATE import_jobs SET status='CANCELLED' WHERE id=?", [req.params.id]); res.json(await summary(req.params.id)); });

// Upload raw CSV (Content-Type: text/csv): sku,name,uom,hsn,qty,rate,godown
r.post("/imports", express.text({ type: "text/csv", limit: "20mb" }), async (req, res) => {
  const data = parseCsv(String(req.body || "")); const godowns = await gnames(); const seen = new Map();
  const [job] = [await q("INSERT INTO import_jobs (org_id,filename,status,rows_total) VALUES (?,?,'VALIDATED',?)", [ORG, req.query.filename || "upload.csv", data.length])];
  const vals = data.map((p, i) => { const bad = validateRow(p, { godowns, seenSkus: seen }); if (!seen.has(p.sku)) seen.set(p.sku, i + 1); return [job.insertId, i + 1, JSON.stringify(p), bad?.kind || null, bad?.msg || null]; });
  for (let i = 0; i < vals.length; i += 500) await q("INSERT INTO import_rows (job_id,row_no,payload,error_kind,error_msg) VALUES ?", [vals.slice(i, i + 500)]);
  res.json(await summary(job.insertId));
});

// Commit: 500 rows per transaction, only VALID or FIXED rows, skipped duplicates ignored
r.post("/imports/:id/commit", async (req, res) => {
  const [job] = await q("SELECT status FROM import_jobs WHERE id=?", [req.params.id]);
  if (job?.status !== "VALIDATED") return res.status(409).json({ error: "Commit is only allowed from the VALIDATED state" });
  const gmap = Object.fromEntries((await q("SELECT id,name FROM warehouses WHERE org_id=?", [ORG])).flatMap((g) => [[g.name.toLowerCase(), g.id], [g.name.split(" ")[0].toLowerCase(), g.id]]));
  const rows = await q("SELECT row_no,payload FROM import_rows WHERE job_id=? AND (error_kind IS NULL OR fixed=1) ORDER BY row_no", [req.params.id]);
  let posted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      for (const x of rows.slice(i, i + 500)) {
        const p = typeof x.payload === "string" ? JSON.parse(x.payload) : x.payload; if (p.skip) continue;
        await c.query("INSERT IGNORE INTO items (org_id,sku,name,hsn,gst_rate,base_uom,batch_tracked) VALUES (?,?,?,?,18,?,1)", [ORG, p.sku, p.name, p.hsn, String(p.uom).toUpperCase()]);
        const [[it]] = await c.query("SELECT id FROM items WHERE org_id=? AND sku=?", [ORG, p.sku]);
        const wid = gmap[String(p.godown).toLowerCase()], qty = Number(p.qty), rate = Number(p.rate);
        const [b] = await c.query("INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,unit_cost,qty_on_hand) VALUES (?,?,?,CURDATE(),?,?) ON DUPLICATE KEY UPDATE qty_on_hand=qty_on_hand+VALUES(qty_on_hand)", [it.id, wid, `OPEN-${req.params.id}`, rate, qty]);
        await c.query("INSERT INTO stock_ledger (org_id,warehouse_id,item_id,batch_id,doc_no,movement,qty,value,reason) VALUES (?,?,?,?,?,'ADJ_UP',?,?,'Opening stock import')", [ORG, wid, it.id, b.insertId || null, `IMP/${req.params.id}`, qty, round(qty * rate)]);
        posted++;
      }
      await c.commit();
    } catch (e) { await c.rollback(); return res.status(500).json({ error: e.message, posted }); } finally { c.release(); }
  }
  await q("UPDATE import_jobs SET status='COMMITTED' WHERE id=?", [req.params.id]);
  res.json({ ok: true, posted });
});

// ---------- Print preview ----------
const W = 32, pad = (a, b) => a + " ".repeat(Math.max(1, W - a.length - b.length)) + b, ctr = (s) => " ".repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
const wrap = (s) => s.match(new RegExp(`.{1,${W}}(\\s|$)`, "g"))?.map((x) => x.trim()) || [s];
const buildPreview = async () => {
  const [org] = await q("SELECT * FROM organizations WHERE id=?", [ORG]);
  const [dc] = await q("SELECT c.*,p.name customer,s.ship_to FROM challans c JOIN parties p ON p.id=c.party_id LEFT JOIN sales_orders s ON s.id=c.so_id WHERE c.doc_no='DC/25-26/00118'");
  if (!dc) return null;
  const [ewb] = await q("SELECT ewb_no FROM eway_bills WHERE challan_id=?", [dc.id]);
  const lineSql = `SELECT i.name,i.hsn,i.base_uom uom,i.gst_rate gst,SUM(cl.qty) qty,cl.rate,SUM(cl.qty*cl.rate) taxable FROM challan_lines cl JOIN items i ON i.id=cl.item_id WHERE cl.challan_id IN (?) GROUP BY i.id,cl.rate`;
  const dl = await q(lineSql, [[dc.id]]);
  const tax = round(dl.reduce((a, l) => a + l.taxable * l.gst / 100, 0)), taxable = round(dl.reduce((a, l) => a + l.taxable, 0)), total = round(taxable + tax);
  const d = new Date(dc.challan_date), f = (n) => String(n).padStart(2, "0");
  const t = [ctr(org.name.toUpperCase()), ctr("Balanagar, Hyderabad 500037"), ctr(`GSTIN ${org.gstin}`), "-".repeat(W), ctr("GATE PASS / DELIVERY CHALLAN"), "-".repeat(W),
    `DC No : ${dc.doc_no}`, `Date  : ${f(d.getDate())}-${f(d.getMonth() + 1)}-${d.getFullYear()} ${f(d.getHours())}:${f(d.getMinutes())}`, `Party : ${dc.customer.toUpperCase()}`,
    `Site  : ${dc.ship_to || ""}`, `Veh   : ${dc.vehicle_no}`, ...(ewb ? [`EWB   : ${ewb.ewb_no.replace(/(\d{4})(?=\d)/g, "$1 ")}`] : []), "-".repeat(W), pad("ITEM", "QTY     AMOUNT"), "-".repeat(W),
    ...dl.flatMap((l) => [...wrap(l.name.toUpperCase()), pad(` ${l.qty.toFixed(3)} ${l.uom}  ${l.rate.toFixed(2)}`, l.taxable.toFixed(2))]), "-".repeat(W),
    pad("Taxable", taxable.toFixed(2)), pad("CGST", (tax / 2).toFixed(2)), pad("SGST", (tax / 2).toFixed(2)), pad("TOTAL", total.toFixed(2)), "-".repeat(W),
    ...wrap(inrWords(total).toUpperCase()), dl.map((l) => `${l.qty} ${l.uom}`).join(" + "), "-".repeat(W), "Receiver signature", "", "_".repeat(24)];

  // A4 invoice preview from the delivered challans of the same party
  const ids = (await q("SELECT id FROM challans WHERE party_id=? AND status IN ('DELIVERED','IN_TRANSIT') AND invoice_id IS NULL", [dc.party_id])).map((x) => x.id);
  const il = await q(lineSql, [ids.length ? ids : [0]]);
  const iTax = il.map((l) => ({ ...l, tax: round(l.taxable * l.gst / 100) }));
  const iTaxable = round(iTax.reduce((a, l) => a + l.taxable, 0)), iTotalTax = round(iTax.reduce((a, l) => a + l.tax, 0));
  const [party] = await q("SELECT * FROM parties WHERE id=?", [dc.party_id]);
  const [adv] = await q("SELECT doc_no,receipt_date,unadjusted FROM receipts WHERE party_id=? AND unadjusted>0 ORDER BY receipt_date LIMIT 1", [dc.party_id]);
  const invNo = await peekDocNo("INV", "INV");
  const invTotal = round(iTaxable + iTotalTax), applied = adv ? Math.min(adv.unadjusted, invTotal) : 0;
  return { thermal: t, org,
    invoice: { no: invNo, date: new Date().toISOString().slice(0, 10), party, lines: iTax, challans: ids.length, taxable: iTaxable, tax: iTotalTax, total: invTotal,
      words: inrWords(invTotal), advance: adv ? { ...adv, applied } : null, balance: round(invTotal - applied) } };
};
r.get("/print/preview", async (_q, res) => res.json(await buildPreview()));
r.get("/print/escpos", async (_q, res) => {   // base64 ESC/POS bytes for the driver app / counter printer
  const p = (await buildPreview())?.thermal || [];
  const bytes = Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from(p.join("\n") + "\n\n\n", "latin1"), Buffer.from([0x1d, 0x56, 0x41, 0x10])]);
  res.json({ bytes: bytes.length, base64: bytes.toString("base64") });
});

export default r;
