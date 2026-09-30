import "dotenv/config";
import { pool } from "./db.js";
import { validateRow } from "./importer.js";

const c = await pool.getConnection();
const ex = (s, p = []) => c.query(s, p).then((r) => r[0]);
const ins = async (s, p) => (await ex(s, p)).insertId;

for (const t of ["import_rows","import_jobs","stock_alerts","receipt_allocations","receipts","invoices","eway_bills","challan_events","challan_lines","challans","sales_order_lines","sales_orders","doc_counters","parties","stock_ledger","batches","item_warehouse_settings","item_uoms","items","uoms","warehouses","organizations"])
  await ex(`DELETE FROM ${t}`);

const org = await ins("INSERT INTO organizations (name,gstin,state_code,address) VALUES (?,?,?,?)",
  ["Sri Venkateswara Traders","36AABCS1429B1ZQ","36","Plot 14, Balanagar Industrial Area, Hyderabad 500037"]);
const wh = {};
for (const [k, n, note, neg] of [["B","Balanagar Godown","Cement, TMT, sand",0],["J","Jeedimetla Yard","Timber, plywood",0],["S","Shop Counter","Fittings, hardware",1]])
  wh[k] = await ins("INSERT INTO warehouses (org_id,name,notes,allow_negative) VALUES (?,?,?,?)", [org,n,note,neg]);

for (const [u, cat] of [["BAG","Weight"],["KG","Weight"],["MT","Weight"],["TRUCK","Count"],["SHEET","Count"],["CFT","Volume"],["NOS","Count"]])
  await ex("INSERT INTO uoms VALUES (?,?)", [u, cat]);

// sku, name, brand, category, hsn, gst, uom, batchTracked, [warehouse, reorder, max]
const itemDefs = [
  ["CEM-UT-PPC-50","UltraTech PPC 50kg bag","UltraTech","Cement","2523",28,"BAG",1,["B",500,3000],["J",100,800],["S",60,400]],
  ["STL-TMT-8","TMT Fe500D 8mm","","Steel","7214",18,"MT",1,["B",2,10]],
  ["CEM-KN-DSP-50","Konark DSP 50kg bag","Konark","Cement","2523",28,"BAG",1,["B",400,2500]],
  ["STL-TMT-12","TMT Fe500D 12mm","","Steel","7214",18,"MT",1,["B",5,20]],
  ["STL-TMT-16","TMT Fe500D 16mm","","Steel","7214",18,"MT",1,["B",5,20]],
  ["AGG-SAND-W","River sand (washed)","","Aggregates","2505",5,"CFT",0,["B",1200,6000]],
  ["PLY-CEN-BWP-19","Century BWP 19mm 8×4","Century","Plywood","4412",18,"SHEET",0,["J",40,200]],
  ["TIM-TEAK-BRM","Teak wood — Burma grade","","Timber","4403",18,"CFT",0,["J",150,600]],
  ["PLY-GRN-MR-12","Greenply MR 12mm 8×4","Greenply","Plywood","4412",18,"SHEET",0,["J",35,200]],
  ["PIP-AST-CPVC-1","Astral CPVC 1\" pipe","Astral","Fittings","3917",18,"NOS",0,["S",60,300]],
  ["ADH-FVC-SH-5","Fevicol SH 5kg","Pidilite","Hardware","3506",18,"NOS",0,["S",24,100]],
];
const item = {};
for (const [sku,name,brand,cat,hsn,gst,uom,bt,...ws] of itemDefs) {
  item[sku] = await ins("INSERT INTO items (org_id,sku,name,brand,category,hsn,gst_rate,base_uom,batch_tracked) VALUES (?,?,?,?,?,?,?,?,?)",
    [org,sku,name,brand,cat,hsn,gst,uom,bt]);
  for (const [w, r, m] of ws) await ex("INSERT INTO item_warehouse_settings VALUES (?,?,?,?)", [item[sku], wh[w], r, m]);
}
const ppc = item["CEM-UT-PPC-50"];
for (const [u, f, t] of [["BAG","Base unit",1],["KG","Linear",0.02],["MT","Linear",20],["TRUCK","Linear · 300 bags",300]])
  await ex("INSERT INTO item_uoms VALUES (?,?,?,?)", [ppc, u, f, t]);

const batch = (sku, w, no, mfg, exp, cost, on, res = 0) =>
  ins("INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,expiry_date,unit_cost,qty_on_hand,qty_reserved) VALUES (?,?,?,?,?,?,?,?)",
    [item[sku], wh[w], no, mfg, exp, cost, on, res]);
// UltraTech batches (match item screen)
await batch("CEM-UT-PPC-50","B","UT-2608-A","2026-08-08","2027-02-07",378.5,620,240);
await batch("CEM-UT-PPC-50","B","UT-2612-B","2026-09-02","2027-03-01",381,620,140);
await batch("CEM-UT-PPC-50","J","UT-2519-C","2026-03-21","2026-09-20",362,40,40);
await batch("CEM-UT-PPC-50","S","UT-2601-D","2026-07-11","2027-01-10",374,96,0);
await batch("CEM-UT-PPC-50","J","UT-2521-E","2026-04-04","2026-10-03",365.5,24,0);
// Other stock (on hand / reserved from alerts screen)
const stock = [
  ["STL-TMT-8","B","J-8001",58000,0.48,0.48],["CEM-KN-DSP-50","B","KN-2609",370,310,120],
  ["STL-TMT-12","B","TMT-J4402",58400,1.1,0],["STL-TMT-12","B","TMT-J4419",58400,2.1,0],
  ["STL-TMT-16","B","TMT-J4500",58900,9.4,0],["AGG-SAND-W","B","SND-1",45,840,0],
  ["PLY-CEN-BWP-19","J","PLY-C1",3150,18,12],["TIM-TEAK-BRM","J","TK-1",1900,62.4,0],
  ["PLY-GRN-MR-12","J","PLY-G1",1450,27,0],["PIP-AST-CPVC-1","S","PIP-1",95,0,0],["ADH-FVC-SH-5","S","FVC-1",612,11,0],
];
for (const [sku,w,no,cost,on,res] of stock) await batch(sku,w,no,"2026-08-01",null,cost,on,res);

// Filler batches so dashboard KPIs (7 near expiry, 23 over-aged) and godown values match the mock
const fill = await ins("INSERT INTO items (org_id,sku,name,category,hsn,gst_rate,base_uom,batch_tracked) VALUES (?,?,?,?,?,?,?,1)",
  [org,"MISC-OPEN","Miscellaneous opening stock","Misc","9999",18,"NOS"]);
item.MISC = fill;
for (let i = 0; i < 6; i++) await ex("INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,expiry_date,unit_cost,qty_on_hand) VALUES (?,?,?,?,?,?,?)",
  [fill, wh.B, `NE-${i}`, "2026-06-01", `2026-10-${String(1 + i * 5).padStart(2, "0")}`, 100, 10]);
for (let i = 0; i < 22; i++) await ex("INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,unit_cost,qty_on_hand) VALUES (?,?,?,?,?,?)",
  [fill, [wh.B, wh.J, wh.S][i % 3], `OA-${i}`, "2026-02-15", 100, 10]);
const target = { B: 8804120, J: 3836900, S: 1570480 };
for (const k of ["B","J","S"]) {
  const [{ v }] = await ex("SELECT COALESCE(SUM(qty_on_hand*unit_cost),0) v FROM batches WHERE warehouse_id=?", [wh[k]]);
  await ex("INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,unit_cost,qty_on_hand) VALUES (?,?,?,?,?,1)",
    [fill, wh[k], `TOPUP-${k}`, "2026-08-01", target[k] - v]);
}

// Alerts (17: 3 out of stock + 14 below reorder)
const alerts = [
  ["B","CEM-UT-PPC-50","OUT_OF_STOCK","out",0],["B","STL-TMT-8","OUT_OF_STOCK","out",0],["B","CEM-KN-DSP-50","BELOW_REORDER","critical",3],
  ["B","STL-TMT-12","BELOW_REORDER","low",6],["B","AGG-SAND-W","BELOW_REORDER","low",9],
  ["J","PLY-CEN-BWP-19","BELOW_REORDER","critical",4],["J","TIM-TEAK-BRM","BELOW_REORDER","low",11],["J","PLY-GRN-MR-12","BELOW_REORDER","low",14],
  ["S","PIP-AST-CPVC-1","OUT_OF_STOCK","out",0],["S","ADH-FVC-SH-5","BELOW_REORDER","low",7],
];
for (const [w,sku,kind,sev,cover] of alerts)
  await ex("INSERT INTO stock_alerts (warehouse_id,item_id,kind,severity,cover_days) VALUES (?,?,?,?,?)", [wh[w], item[sku], kind, sev, cover]);
for (const [w, n] of [["B",4],["J",2],["S",1]]) for (let i = 0; i < n; i++)
  await ex("INSERT INTO stock_alerts (warehouse_id,item_id,kind,severity,cover_days) VALUES (?,?,?,?,?)", [wh[w], fill, "BELOW_REORDER", "low", 8 + i]);

// Parties
const P = {};
for (const [k,n,g,m,l] of [["RC","Rajesh Constructions","36AAJCR8821K1Z4","9849011204",1000000],
  ["RH","Rajeshwari Hardware","36ABKFR2210M1ZP","9963077812",500000],["RK","Rajesh Kumar (counter)",null,"7093845119",50000]])
  P[k] = await ins("INSERT INTO parties (org_id,name,gstin,mobile,credit_limit) VALUES (?,?,?,?,?)", [org,n,g,m,l]);

// Sales orders — counts/values per pipeline stage match the dashboard mock
const pipe = [["DRAFT",9,712400],["CONFIRMED",24,4186300],["PARTIAL",19,2240110],["DELIVERED",11,1308970]];
let n = 1;
for (const [st, cnt, tot] of pipe) for (let i = 0; i < cnt; i++) {
  const v = i === cnt - 1 ? tot - Math.floor(tot / cnt) * (cnt - 1) : Math.floor(tot / cnt);
  await ex("INSERT INTO sales_orders (org_id,doc_no,party_id,warehouse_id,order_date,status,taxable,tax,total) VALUES (?,?,?,?,?,?,?,?,?)",
    [org, `SO/25-26/${String(n++).padStart(5,"0")}`, P.RC, wh.B, "2026-09-10", st, v/1.18, v - v/1.18, v]);
}

// SO/25-26/00042 (draft, Rajesh Constructions) — the sales-order screen; drafts still total 9 / ₹7,12,400
await ex("UPDATE sales_orders SET total=32620,taxable=32620/1.18,tax=32620-32620/1.18 WHERE status='DRAFT'");
const so42 = await ins("UPDATE sales_orders SET doc_no='SO/25-26/00042',order_date='2026-09-22',ship_to='Site 4, Kompally',terms='Net 30',autosaved_at=NOW(),taxable=370000,tax=81440,total=451440 WHERE doc_no='SO/25-26/00009'") ;
const [{ id: soId }] = await ex("SELECT id FROM sales_orders WHERE doc_no='SO/25-26/00042'");
let ln = 1;
for (const [sku, w, qty, uom, rate, disc, gst, taxable, amt] of [
  ["CEM-UT-PPC-50","B",400,"BAG",385,3.64,28,148400,189952],["STL-TMT-12","B",2.5,"MT",58400,0,18,146000,172280],["PLY-CEN-BWP-19","J",24,"SHEET",3150,0,18,75600,89208]])
  await ex("INSERT INTO sales_order_lines (so_id,line_no,item_id,warehouse_id,qty,uom,rate,disc_pct,gst_pct,taxable,amount) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [soId, ln++, item[sku], wh[w], qty, uom, rate, disc, gst, taxable, amt]);
// Invoices: 38 awaiting payment totalling 56,71,540; 12 overdue with 9,84,220 receivable (incl. the mock rows)
const inv = (no,p,w,d,due,total,bal) => ex(
  "INSERT INTO invoices (org_id,doc_no,party_id,warehouse_id,invoice_date,due_date,taxable,cgst,sgst,total,balance_due) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  [org,`INV/25-26/${no}`,p,wh[w],d,due,total/1.18,total*0.09/1.18,total*0.09/1.18,total,bal]);
await inv("00317",P.RC,"B","2026-09-18","2026-09-18",451440,351440);
await inv("00309",P.RC,"J","2026-09-11","2026-09-11",218300,218300);
await inv("00298",P.RH,"S","2026-09-04","2026-09-04",88120,88120);
await inv("00291",P.RC,"B","2026-09-01","2026-09-01",604780,120000);
let rest = 5671540 - (351440 + 218300 + 88120 + 120000), odLeft = 984220 - (351440 + 218300 + 88120 + 120000) ;
for (let i = 0; i < 34; i++) {
  const bal = Math.floor(rest / (34 - i)); rest -= bal;
  await inv(String(100 + i).padStart(5,"0"), P.RH, "S", "2026-09-05", "2026-10-25", bal, bal);
}
// Challans from the mock
const dc = (no,p,w,d,st,total) => ex(
  "INSERT INTO challans (org_id,doc_no,party_id,warehouse_id,challan_date,status,taxable,tax,total,pod_signed) VALUES (?,?,?,?,?,?,?,?,?,?)",
  [org,`DC/25-26/${no}`,p,wh[w],d,st,total/1.18,total-total/1.18,total,st==="DELIVERED"?1:0]);
await dc("00118",P.RC,"B","2026-09-22 10:41:00","IN_TRANSIT",154000);
await dc("00116",P.RC,"B","2026-09-20 10:00:00","DELIVERED",209888);
await dc("00114",P.RH,"S","2026-09-19 10:00:00","DELIVERED",62880);
await dc("00109",P.RK,"S","2026-09-02 10:00:00","DELIVERED",19450);
await dc("00103",P.RC,"B","2026-08-29 10:00:00","INVOICED",311900);

// Challan 118 (in transit) + 116 (delivered) get lines so invoicing can compute per-rate tax; 118 gets its e-way bill and timeline
const cid = async (no) => (await ex("SELECT id FROM challans WHERE doc_no=?", [`DC/25-26/${no}`]))[0].id;
const [c118, c116] = [await cid("00118"), await cid("00116")];
await ex("UPDATE challans SET so_id=?,vehicle_no='TS09UB4472',driver='M. Yadagiri',driver_mobile='90000 45512',transporter='Sri Balaji Roadlines',distance_km=148 WHERE id=?", [soId, c118]);
await ex("UPDATE challans SET so_id=? WHERE id=?", [soId, c116]);
const cl = (c, sku, q, rate, no) => ex("INSERT INTO challan_lines (challan_id,item_id,batch_id,qty,rate) VALUES (?,?,(SELECT id FROM batches WHERE batch_no=? LIMIT 1),?,?)", [c, item[sku], no, q, rate]);
await cl(c118, "CEM-UT-PPC-50", 400, 371, "UT-2608-A"); await cl(c118, "STL-TMT-12", 1.5, 58400, "TMT-J4419");
await cl(c116, "PLY-CEN-BWP-19", 24, 3150, "PLY-C1"); await cl(c116, "STL-TMT-16", 1, 58400, "TMT-J4500");
await ex("INSERT INTO eway_bills (challan_id,ewb_no,valid_until,idempotency_key,vehicle_no,transporter_gstin,transporter_doc_no,gsp_log) VALUES (?,?,?,?,?,?,?,?)",
  [c118, "151234567890", "2026-09-23 23:59:00", "9f2c-dc118-ewb", "TS09UB4472", "36AACCS441", "LR-88421", "attempt 1 · 10:53:02 · 200 OK · 1,284 ms"]);
for (const [ev, note, at] of [["Draft created","Harish K.","2026-09-22 10:41"],["Stock posted — DC_ISSUE","ledger #48211","2026-09-22 10:52"],["E-way bill generated","CLEARTAX","2026-09-22 10:53"],["Vehicle departed","gate pass printed","2026-09-22 11:06"]])
  await ex("INSERT INTO challan_events (challan_id,event,note,at) VALUES (?,?,?,?)", [c118, ev, note, at]);
// Advances
for (const [no,d,m,a] of [["00071","2026-09-02","NEFT",100000],["00079","2026-09-14","Cheque",38000],["00084","2026-09-19","Cash",10000]])
  await ex("INSERT INTO receipts (org_id,doc_no,party_id,receipt_date,mode,amount,unadjusted) VALUES (?,?,?,?,?,?,?)",
    [org,`RCT/25-26/${no}`,P.RC,d,m,a,a]);
// Today's movements
const led = [["10:52","DC/25-26/00118","CEM-UT-PPC-50","B","DC_ISSUE",-400,154000],["10:18","GRN/25-26/00204","STL-TMT-16","B","PURCHASE",6,342600],
  ["09:47","DC/25-26/00117","PLY-CEN-BWP-19","B","DC_ISSUE",-24,75600],["09:05","XFR/25-26/00031","CEM-KN-DSP-50","B","TRANSFER_OUT",-250,92500],
  ["08:31","ADJ/25-26/00012","AGG-SAND-W","B","ADJ_DOWN",-3.4,4760]];
for (const [t,doc,sku,w,mv,qty,val] of led) {
  const dt = new Date(); const [h, m] = t.split(":"); dt.setHours(+h, +m, 0, 0);
  await ex("INSERT INTO stock_ledger (org_id,warehouse_id,item_id,doc_no,movement,qty,value,posted_at) VALUES (?,?,?,?,?,?,?,?)",
    [org, wh[w], item[sku], doc, mv, qty, Math.abs(val), dt]);
}
await ex("INSERT INTO doc_counters VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?)", [org,"INV","25-26",317,org,"DC","25-26",118,org,"SO","25-26",42]);

// Bulk-import demo job: 5,000 rows, 312 with errors (47 already fixed) — same shape as the mock
const job = await ins("INSERT INTO import_jobs (org_id,filename,status,rows_total,rows_valid,rows_error) VALUES (?,?,?,?,?,?)", [org,"opening-stock-sep26.csv","VALIDATED",5000,4688,312]);
const specials = {
  18: ["UOM",{ sku:"CEM-UT-PPC-50", name:"UltraTech PPC 50kg bag", uom:"BAGS", hsn:"2523", qty:"620.000", rate:"378.50", godown:"Balanagar" }],
  41: ["HSN",{ sku:"STL-TMT-12", name:"TMT Fe500D 12mm", uom:"MT", hsn:"721", qty:"3.200", rate:"58400.00", godown:"Balanagar" }],
  63: ["DUP",{ sku:"PLY-CEN-BWP-19", name:"Century BWP 19mm 8x4", uom:"SHEET", hsn:"4412", qty:"18.000", rate:"3150.00", godown:"Jeedimetla" }],
  88: ["RATE",{ sku:"AGG-SAND-W", name:"River sand (washed)", uom:"CFT", hsn:"2505", qty:"840.000", rate:"1,2O0", godown:"Balanagar" }],
  104: ["NEG",{ sku:"TIM-TEAK-BRM", name:"Teak wood, Burma grade", uom:"CFT", hsn:"4403", qty:"-62.400", rate:"4250.00", godown:"Jeedimetla" }],
  129: ["GODOWN",{ sku:"ADH-FVC-SH-5", name:"Fevicol SH 5kg", uom:"NOS", hsn:"3506", qty:"11.000", rate:"612.00", godown:"Balanager" }],
};
const need = { UOM:118, HSN:74, DUP:52, RATE:38, GODOWN:21, NEG:9 };
Object.values(specials).forEach(([k]) => need[k]--);
const bad = {
  UOM: (p) => ({ ...p, uom: "BAGS" }), HSN: (p) => ({ ...p, hsn: "72" }), DUP: (p) => ({ ...p, sku: "SKU-0044" }),
  RATE: (p) => ({ ...p, rate: "12x" }), GODOWN: (p) => ({ ...p, godown: "Balanager" }), NEG: (p) => ({ ...p, qty: "-5.000" }),
};
const msg = { UOM:"Unknown UOM. Did you mean BAG?", HSN:"HSN must be 4, 6 or 8 digits", DUP:"Duplicate of row 44", RATE:"Rate is not a number", GODOWN:"Godown not found", NEG:"Opening quantity cannot be negative" };
const kindsLeft = Object.entries(need).flatMap(([k, n]) => Array(n).fill(k));
const irows = []; let fixedLeft = 47, ki = 0;
for (let i = 1; i <= 5000; i++) {
  let p = { sku: i === 44 ? "PLY-CEN-BWP-19" : `SKU-${String(i).padStart(4, "0")}`, name: `Item ${i}`, uom: "NOS", hsn: "3926", qty: "10.000", rate: "100.00", godown: "Balanagar" };
  let kind = null, m = null, fixed = 0;
  if (specials[i]) { [kind, p] = specials[i]; m = msg[kind]; }
  else if (i > 200 && i % 15 === 0 && ki < kindsLeft.length) { kind = kindsLeft[ki++]; p = bad[kind](p); m = msg[kind]; if (fixedLeft-- > 0) fixed = 1; }
  irows.push([job, i, JSON.stringify(p), kind, m, fixed]);
}
for (let i = 0; i < irows.length; i += 500) await ex("INSERT INTO import_rows (job_id,row_no,payload,error_kind,error_msg,fixed) VALUES ?", [irows.slice(i, i + 500)]);
console.log("Demo data seeded.");
c.release(); process.exit(0);
