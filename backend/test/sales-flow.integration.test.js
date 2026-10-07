import test from 'node:test';
import assert from 'node:assert/strict';

test('sales chain: order → reservation → challan → dispatch → invoice → receipt', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { default: sales } = await import('../routes/sales.js');
  const { default: invoicing } = await import('../routes/invoicing.js');
  const { default: receipts } = await import('../routes/receipts.js');
  const { fyLabel } = await import('../services/sales/docNo.js');
  const { pool } = await import('../db.js');
  const { ORG } = await import('../org.js');
  const tag = `SF${Date.now()}`;
  const app = express();
  app.use(express.json());
  app.use(invoicing); app.use(receipts); app.use(sales);
  const ids = { p: [], w: [], i: [] };
  const post = (u, b) => request(app).post(u).send(b || {});
  const put = (u, b) => request(app).put(u).send(b);
  const get = (u) => request(app).get(u);
  const val = async (sql, a = []) => Object.values((await pool.query(sql, a))[0][0] || {})[0];
  const ins = async (sql, a) => (await pool.query(sql, a))[0].insertId;

  t.after(async () => {
    const P = ids.p.length ? ids.p : [0], I = ids.i.length ? ids.i : [0], W = ids.w.length ? ids.w : [0];
    await pool.query('DELETE FROM receipt_allocations WHERE receipt_id IN (SELECT id FROM receipts WHERE party_id IN (?))', [P]);
    await pool.query('DELETE FROM receipts WHERE party_id IN (?)', [P]);
    await pool.query('DELETE FROM invoices WHERE party_id IN (?)', [P]);
    await pool.query('DELETE FROM eway_bills WHERE challan_id IN (SELECT id FROM challans WHERE party_id IN (?))', [P]);
    await pool.query('DELETE FROM challans WHERE party_id IN (?)', [P]);
    await pool.query('DELETE FROM sales_orders WHERE party_id IN (?)', [P]);
    await pool.query('DELETE FROM stock_ledger WHERE item_id IN (?)', [I]);
    await pool.query('DELETE FROM batches WHERE item_id IN (?)', [I]);
    await pool.query('DELETE FROM item_warehouse_settings WHERE item_id IN (?) OR warehouse_id IN (?)', [I, W]);
    await pool.query('DELETE FROM items WHERE id IN (?)', [I]);
    await pool.query('DELETE FROM warehouses WHERE id IN (?)', [W]);
    await pool.query('DELETE FROM parties WHERE id IN (?)', [P]);
    await pool.end();
  });

  const party = async (name, gstin, type = 'CUSTOMER') => { const id = await ins('INSERT INTO parties (org_id,name,gstin,party_type,credit_limit) VALUES (?,?,?,?,1000000)', [ORG, `${tag} ${name}`, gstin, type]); ids.p.push(id); return id; };
  const wh = async (name, neg = 0) => { const id = await ins('INSERT INTO warehouses (org_id,name,allow_negative) VALUES (?,?,?)', [ORG, `${tag} ${name}`, neg]); ids.w.push(id); return id; };
  let n = 0;
  const item = async (gst) => { const id = await ins("INSERT INTO items (org_id,sku,name,hsn,gst_rate,base_uom) VALUES (?,?,?,?,?,'NOS')", [ORG, `${tag}-${++n}`, `Item ${n}`, '2523', gst]); ids.i.push(id); return id; };
  const batch = (it, w, qty, mfg = '2026-01-01') => ins('INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,unit_cost,qty_on_hand) VALUES (?,?,?,?,10,?)', [it, w, `B${++n}`, mfg, qty]);
  const stock = (it) => pool.query('SELECT COALESCE(SUM(qty_on_hand),0) h,COALESCE(SUM(qty_reserved),0) r FROM batches WHERE item_id=?', [it]).then(([[x]]) => ({ h: Number(x.h), r: Number(x.r) }));
  const order = (p, w, lines, extra = {}) => post('/sales-orders', { party_id: p, warehouse_id: w, order_date: '2026-10-08', lines, ...extra });
  const ship = async (soId) => {
    const dc = (await post('/challans', { so_id: soId })).body;
    const allocations = dc.lines.flatMap((l) => l.batches.filter((b) => b.qty > 0).map((b) => ({ so_line_id: l.id, item_id: l.item_id, batch_id: b.id, qty: b.qty })));
    await put(`/challans/${dc.id}`, { transport: { vehicle_no: 'TS09AB1234' }, allocations });
    const out = await post(`/challans/${dc.id}/dispatch`);
    return { dc, out };
  };

  const cust = await party('Local', '36AAAAA0000A1Z5'), inter = await party('Inter', '29AAAAA0000A1Z5'), sup = await party('Supplier', null, 'SUPPLIER');
  const W = await wh('Main'), WN = await wh('Neg', 1);
  let so, dc, inv, i1, i2;

  await t.test('creates an order with server-side recalculation and a dynamic-FY number', async () => {
    i1 = await item(18); i2 = await item(12);
    await batch(i1, W, 60, '2026-01-01'); await batch(i1, W, 40, '2026-02-01'); await batch(i2, W, 100);
    const res = await order(cust, W, [{ item_id: i1, qty: 80, rate: 100, disc_pct: 10, gst_pct: 5 }, { item_id: i2, qty: 10, rate: 50, gst_pct: 28 }]);
    assert.equal(res.status, 201);
    so = res.body;
    assert.match(so.doc_no, new RegExp(`^SO/${fyLabel()}/\\d{5}$`));
    assert.deepEqual(so.lines.map((l) => Number(l.gst_pct)), [18, 12], 'GST taken from item master, not client');
    assert.equal(so.totals.taxable, 7700);
    assert.equal(so.totals.total, 9056);
    assert.equal(so.status, 'DRAFT');
  });

  await t.test('rejects invalid orders', async () => {
    assert.equal((await order(sup, W, [{ item_id: i1, qty: 1, rate: 1 }])).status, 422, 'supplier is not a customer');
    assert.equal((await order(cust, W, [])).status, 422);
    assert.equal((await order(cust, W, [{ item_id: i1, qty: 1, rate: -5 }])).status, 422);
    assert.equal((await order(cust, 999999999, [{ item_id: i1, qty: 1, rate: 1 }])).status, 422);
  });

  await t.test('confirm reserves FIFO without touching on-hand, and a retry does not double-reserve', async () => {
    assert.equal((await post(`/sales-orders/${so.id}/confirm`)).status, 200);
    assert.deepEqual(await stock(i1), { h: 100, r: 80 });
    assert.equal((await post(`/sales-orders/${so.id}/confirm`)).status, 409);
    assert.equal((await post(`/sales-orders/${so.id}/reserve`)).status, 200);
    assert.deepEqual(await stock(i1), { h: 100, r: 80 });
    const rs = (await get(`/sales-orders/${so.id}/reservations`)).body.lines[0];
    assert.equal(rs.reserved, 80);
    assert.deepEqual(rs.batches.map((b) => b.qty), [60, 20]);
  });

  await t.test('insufficient stock blocks confirm and leaves nothing reserved', async () => {
    const it = await item(18); await batch(it, W, 5);
    const s = (await order(cust, W, [{ item_id: it, qty: 9, rate: 1 }])).body;
    const res = await post(`/sales-orders/${s.id}/confirm`);
    assert.equal(res.status, 409);
    assert.deepEqual(await stock(it), { h: 5, r: 0 });
  });

  await t.test('partial reservation where the godown allows negative stock, topped up later', async () => {
    const it = await item(18); await batch(it, WN, 10);
    const s = (await order(cust, WN, [{ item_id: it, qty: 15, rate: 1 }])).body;
    assert.equal((await post(`/sales-orders/${s.id}/confirm`)).status, 200);
    assert.equal((await stock(it)).r, 10);
    await batch(it, WN, 10, '2026-03-01');
    await post(`/sales-orders/${s.id}/reserve`);
    assert.equal((await stock(it)).r, 15);
  });

  await t.test('challan inherits the order and allocates the order\'s own reserved batches', async () => {
    const res = await post('/challans', { so_id: so.id });
    assert.equal(res.status, 201);
    dc = res.body;
    assert.equal(dc.so_id, so.id);
    const l1 = dc.lines.find((l) => l.item_id === i1);
    assert.equal(l1.this_challan, 80, 'full reserved quantity is allocatable');
    assert.equal((await post('/challans', { so_id: so.id })).body.id, dc.id, 'same open draft is returned');
    assert.match(dc.doc_no, new RegExp(`^DC/${fyLabel()}/`));
  });

  await t.test('challan validation: rate from order, caps, vehicle', async () => {
    const l1 = dc.lines.find((l) => l.item_id === i1), b = l1.batches[0];
    const over = await put(`/challans/${dc.id}`, { allocations: [{ so_line_id: l1.id, batch_id: b.id, qty: 81, rate: 1 }] });
    assert.equal(over.status, 422);
    const foreign = await put(`/challans/${dc.id}`, { allocations: [{ so_line_id: l1.id, batch_id: (await val('SELECT id FROM batches WHERE item_id=? LIMIT 1', [i2])), qty: 1 }] });
    assert.equal(foreign.status, 422, 'batch of another item');
    const allocations = dc.lines.flatMap((l) => l.batches.filter((x) => x.qty > 0).map((x) => ({ so_line_id: l.id, item_id: l.item_id, batch_id: x.id, qty: x.qty, rate: 9999 })));
    assert.equal((await put(`/challans/${dc.id}`, { allocations })).status, 200);
    assert.equal(Number(await val('SELECT MAX(rate) FROM challan_lines WHERE challan_id=?', [dc.id])), 100, 'client rate ignored');
    assert.equal((await post(`/challans/${dc.id}/dispatch`)).status, 422, 'vehicle number required');
    await put(`/challans/${dc.id}`, { transport: { vehicle_no: 'TS09AB1234' }, allocations });
  });

  await t.test('dispatch issues stock once: on-hand down, reservation released, DC_ISSUE ledger, order updated', async () => {
    assert.equal((await post(`/challans/${dc.id}/dispatch`)).status, 200);
    assert.deepEqual(await stock(i1), { h: 20, r: 0 });
    const led = (await pool.query("SELECT qty FROM stock_ledger WHERE doc_no=? AND item_id=? AND movement='DC_ISSUE'", [dc.doc_no, i1]))[0];
    assert.equal(led.reduce((s, x) => s + Number(x.qty), 0), -80);
    const o = (await get(`/sales-orders/${so.id}`)).body;
    assert.equal(o.status, 'DELIVERED');
    assert.equal(Number(o.lines[0].qty_sent), 80);
    assert.equal(await val('SELECT COUNT(*) FROM so_reservations r JOIN sales_order_lines l ON l.id=r.so_line_id WHERE l.so_id=?', [so.id]), 0);
    const again = await post(`/challans/${dc.id}/dispatch`);
    assert.equal(again.status, 409);
    assert.deepEqual(await stock(i1), { h: 20, r: 0 });
    assert.equal(await val("SELECT COUNT(*) FROM stock_ledger WHERE doc_no=? AND movement='DC_ISSUE'", [dc.doc_no]), 3, 'no duplicate issue');
  });

  await t.test('concurrent dispatch of one challan issues stock exactly once', async () => {
    const it = await item(18); await batch(it, W, 50);
    const s = (await order(cust, W, [{ item_id: it, qty: 30, rate: 10 }])).body;
    await post(`/sales-orders/${s.id}/confirm`);
    const d = (await post('/challans', { so_id: s.id })).body;
    const allocations = d.lines.flatMap((l) => l.batches.filter((x) => x.qty > 0).map((x) => ({ so_line_id: l.id, batch_id: x.id, qty: x.qty })));
    await put(`/challans/${d.id}`, { transport: { vehicle_no: 'TS09AB1234' }, allocations });
    const [a, b] = await Promise.all([post(`/challans/${d.id}/dispatch`), post(`/challans/${d.id}/dispatch`)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.deepEqual(await stock(it), { h: 20, r: 0 });
  });

  await t.test('invoice from challan: inherited links, server totals, per-rate GST, CGST/SGST', async () => {
    const res = await post(`/invoices/from-challan/${dc.id}`);
    assert.equal(res.status, 201);
    inv = res.body;
    assert.match(inv.docNo, new RegExp(`^INV/${fyLabel()}/`));
    assert.equal(inv.taxable, 7700); assert.equal(inv.total, 9056);
    assert.deepEqual([inv.cgst, inv.sgst, inv.igst], [678, 678, 0]);
    const d = (await get(`/invoices/${inv.id}`)).body;
    assert.equal(d.status, 'ISSUED');
    assert.equal(d.so.id, so.id);
    assert.deepEqual(d.challans.map((c) => c.id), [dc.id]);
    assert.equal(d.lines.length, 2);
    assert.equal((await get(`/sales-orders/${so.id}`)).body.status, 'INVOICED');
  });

  await t.test('a challan can be billed only once', async () => {
    assert.equal((await post(`/invoices/from-challan/${dc.id}`)).status, 409);
    assert.equal((await post('/invoices', { partyId: cust, challanIds: [dc.id] })).status, 409);
    assert.equal((await post('/invoices', { partyId: cust, challanIds: [] })).status, 422);
    const open = (await post('/challans', { so_id: so.id }));
    assert.equal(open.status, 409, 'invoiced order cannot be dispatched again');
  });

  await t.test('inter-state invoice uses IGST', async () => {
    const it = await item(18); await batch(it, W, 10);
    const s = (await order(inter, W, [{ item_id: it, qty: 10, rate: 100 }])).body;
    await post(`/sales-orders/${s.id}/confirm`);
    const { dc: d2 } = await ship(s.id);
    const r2 = (await post(`/invoices/from-challan/${d2.id}`)).body;
    assert.deepEqual([r2.cgst, r2.sgst, r2.igst, r2.total], [0, 0, 180, 1180]);
  });

  await t.test('receipts: partial, overpayment blocked, full payment marks PAID', async () => {
    const p1 = await post('/receipts', { party_id: cust, amount: 3000, mode: 'UPI', reference: 'UTR1', allocations: [{ invoice_id: inv.id, amount: 3000 }] });
    assert.equal(p1.status, 201);
    assert.match(p1.body.doc_no, new RegExp(`^RCT/${fyLabel()}/`));
    let d = (await get(`/invoices/${inv.id}`)).body;
    assert.deepEqual([d.status, d.balance_due, d.paid], ['PARTIALLY_PAID', 6056, 3000]);
    const before = await val('SELECT COUNT(*) FROM receipts WHERE party_id=?', [cust]);
    const over = await post('/receipts', { party_id: cust, amount: 7000, mode: 'Cash', allocations: [{ invoice_id: inv.id, amount: 7000 }] });
    assert.equal(over.status, 422);
    assert.equal(await val('SELECT COUNT(*) FROM receipts WHERE party_id=?', [cust]), before, 'nothing posted');
    assert.equal((await post('/receipts', { party_id: cust, amount: 100, mode: 'Cash', allocations: [{ invoice_id: inv.id, amount: 200 }] })).status, 422, 'allocation above receipt amount');
    assert.equal((await post('/receipts', { party_id: inter, amount: 10, mode: 'Cash', allocations: [{ invoice_id: inv.id, amount: 10 }] })).status, 404, "another customer's invoice");
    assert.equal((await post('/receipts', { party_id: cust, amount: 0, mode: 'Cash' })).status, 422);
    assert.equal((await post('/receipts', { party_id: cust, amount: 5, mode: 'Barter' })).status, 422);
    assert.equal((await post('/receipts', { party_id: cust, amount: 6056, mode: 'NEFT', allocations: [{ invoice_id: inv.id, amount: 6056 }] })).status, 201);
    d = (await get(`/invoices/${inv.id}`)).body;
    assert.deepEqual([d.status, d.balance_due], ['PAID', 0]);
    assert.equal(d.receipts.length, 2);
    assert.equal((await post(`/invoices/${inv.id}/cancel`)).status, 409, 'paid invoice cannot be cancelled');
  });

  await t.test('advance stays unapplied until allocated, never beyond what is unapplied or owed', async () => {
    const it = await item(18); await batch(it, W, 10);
    const s = (await order(cust, W, [{ item_id: it, qty: 10, rate: 100 }])).body;   // total 1180
    await post(`/sales-orders/${s.id}/confirm`);
    const { dc: d3 } = await ship(s.id);
    const i3 = (await post(`/invoices/from-challan/${d3.id}`)).body;
    const adv = (await post('/receipts', { party_id: cust, amount: 1000, mode: 'NEFT' })).body;
    assert.deepEqual([adv.unadjusted, adv.is_advance, adv.allocations.length], [1000, true, 0]);
    assert.equal((await post(`/receipts/${adv.id}/allocate`, { allocations: [{ invoice_id: i3.id, amount: 1200 }] })).status, 422);
    assert.equal((await post(`/receipts/${adv.id}/allocate`, { allocations: [{ invoice_id: i3.id, amount: 600 }] })).body.unadjusted, 400);
    assert.equal((await get(`/invoices/${i3.id}`)).body.balance_due, 580);
    const c = await post(`/receipts/${adv.id}/cancel`);
    assert.deepEqual([c.body.status, c.body.unadjusted], ['CANCELLED', 0]);
    const back = (await get(`/invoices/${i3.id}`)).body;
    assert.deepEqual([back.balance_due, back.status], [1180, 'ISSUED']);
    assert.equal((await post(`/receipts/${adv.id}/cancel`)).status, 409);
  });

  await t.test('unpaid invoice cancels: challan and order become billable again', async () => {
    const it = await item(5); await batch(it, W, 10);
    const s = (await order(cust, W, [{ item_id: it, qty: 4, rate: 100 }])).body;
    await post(`/sales-orders/${s.id}/confirm`);
    const { dc: d4 } = await ship(s.id);
    const i4 = (await post(`/invoices/from-challan/${d4.id}`)).body;
    assert.equal((await post(`/invoices/${i4.id}/cancel`)).status, 200);
    const [[c]] = await pool.query('SELECT status,invoice_id FROM challans WHERE id=?', [d4.id]);
    assert.deepEqual([c.status, c.invoice_id], ['IN_TRANSIT', null]);
    assert.equal((await get(`/sales-orders/${s.id}`)).body.status, 'DELIVERED');
    assert.equal((await get(`/invoices/${i4.id}`)).body.balance_due, 0);
    assert.equal((await post(`/invoices/from-challan/${d4.id}`)).status, 201);
    assert.equal((await post(`/invoices/${i4.id}/cancel`)).status, 409, 'already cancelled');
  });

  await t.test('order cancel releases reservations; dispatched orders cannot be cancelled', async () => {
    const it = await item(18); await batch(it, W, 20);
    const s = (await order(cust, W, [{ item_id: it, qty: 12, rate: 1 }])).body;
    await post(`/sales-orders/${s.id}/confirm`);
    await post('/challans', { so_id: s.id });
    assert.equal((await stock(it)).r, 12);
    assert.equal((await post(`/sales-orders/${s.id}/cancel`)).status, 200);
    assert.deepEqual(await stock(it), { h: 20, r: 0 });
    assert.equal(await val("SELECT COUNT(*) FROM challans WHERE so_id=? AND status='CANCELLED'", [s.id]), 1);
    assert.equal((await post(`/sales-orders/${s.id}/cancel`)).status, 409);
    assert.equal((await post(`/sales-orders/${so.id}/cancel`)).status, 409);
    assert.equal((await put(`/sales-orders/${s.id}`, { party_id: cust, warehouse_id: W, lines: [{ item_id: it, qty: 1, rate: 1 }] })).status, 409, 'only drafts are editable');
  });

  await t.test('draft order can be edited and cancelled; challan needs a confirmed order', async () => {
    const it = await item(18); await batch(it, W, 5);
    const s = (await order(cust, W, [{ item_id: it, qty: 1, rate: 10 }], { reference: 'PO-77' })).body;
    assert.equal(s.reference, 'PO-77');
    const e = await put(`/sales-orders/${s.id}`, { party_id: cust, warehouse_id: W, order_date: '2026-10-09', lines: [{ item_id: it, qty: 2, rate: 10 }] });
    assert.equal(e.status, 200); assert.equal(e.body.totals.taxable, 20);
    assert.equal((await post('/challans', { so_id: s.id })).status, 409);
    assert.equal((await post(`/sales-orders/${s.id}/cancel`)).status, 200);
  });

  await t.test('draft challan cancel; dispatched challan cannot be cancelled; deliver action', async () => {
    const it = await item(18); await batch(it, W, 5);
    const s = (await order(cust, W, [{ item_id: it, qty: 2, rate: 10 }])).body;
    await post(`/sales-orders/${s.id}/confirm`);
    const d = (await post('/challans', { so_id: s.id })).body;
    assert.equal((await post(`/challans/${d.id}/deliver`)).status, 409, 'not in transit yet');
    const { dc: d5 } = await ship(s.id);
    assert.equal((await post(`/challans/${d5.id}/cancel`)).status, 409);
    assert.equal((await post(`/challans/${d5.id}/deliver`)).status, 200);
    assert.equal((await get(`/challans/${d5.id}`)).body.status, 'DELIVERED');
    assert.ok((await get('/challans?status=DELIVERED')).body.rows.some((x) => x.id === d5.id));
  });
});
