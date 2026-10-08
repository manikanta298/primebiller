import test from 'node:test';
import assert from 'node:assert/strict';

test('stock transfers and adjustments: create, issue, receive, approve', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { default: pending } = await import('../routes/pending.js');
  const { default: stockActions } = await import('../routes/stockActions.js');
  const { fyLabel } = await import('../services/sales/docNo.js');
  const { pool } = await import('../db.js');
  const { ORG } = await import('../org.js');
  const tag = `SA${Date.now()}`;
  const app = express();
  app.use(express.json()); app.use(pending); app.use(stockActions);
  const post = (u, b) => request(app).post(u).send(b || {});
  const ins = async (sql, a) => (await pool.query(sql, a))[0].insertId;
  const ids = { w: [], i: [] };

  t.after(async () => {
    const W = ids.w.length ? ids.w : [0], I = ids.i.length ? ids.i : [0];
    await pool.query('DELETE FROM stock_adjustments WHERE item_id IN (?)', [I]);
    await pool.query('DELETE FROM stock_ledger WHERE item_id IN (?)', [I]);
    await pool.query('DELETE FROM stock_transfers WHERE from_warehouse_id IN (?) OR to_warehouse_id IN (?)', [W, W]);   // lines cascade
    await pool.query('DELETE FROM batches WHERE item_id IN (?)', [I]);
    await pool.query('DELETE FROM item_warehouse_settings WHERE item_id IN (?) OR warehouse_id IN (?)', [I, W]);
    await pool.query('DELETE FROM items WHERE id IN (?)', [I]);
    await pool.query('DELETE FROM warehouses WHERE id IN (?)', [W]);
    await pool.end();
  });

  const wh = async (n) => { const id = await ins('INSERT INTO warehouses (org_id,name) VALUES (?,?)', [ORG, `${tag} ${n}`]); ids.w.push(id); return id; };
  const A = await wh('A'), B = await wh('B'), C = await wh('C');
  const it = await ins("INSERT INTO items (org_id,sku,name,hsn,gst_rate,base_uom) VALUES (?,?,?,?,18,'NOS')", [ORG, `${tag}-1`, 'Test item', '2523']); ids.i.push(it);
  const batch = (w, qty, reserved = 0) => ins('INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,unit_cost,qty_on_hand,qty_reserved) VALUES (?,?,?,?,10,?,?)', [it, w, `${tag}-B${w}`, '2026-01-01', qty, reserved]);
  const row = async (id) => (await pool.query('SELECT qty_on_hand h,qty_reserved r FROM batches WHERE id=?', [id]))[0][0];
  const bA = await batch(A, 50, 10), bC = await batch(C, 5);

  await t.test('batch picker returns free stock for one godown', async () => {
    const res = await request(app).get(`/stock/batches?warehouse_id=${A}&search=${tag}`);
    assert.equal(res.status, 200);
    const b = res.body.rows.find((x) => x.batch_id === bA);
    assert.equal(Number(b.free), 40);
    assert.equal((await request(app).get('/stock/batches')).status, 422);
    assert.equal((await request(app).get(`/stock/batches?warehouse_id=${C}`)).body.rows.find((x) => x.batch_id === bA), undefined, 'other godown excluded');
  });

  await t.test('transfer with lines is sent: source stock leaves, ledger TRANSFER_OUT, status IN_TRANSIT', async () => {
    const res = await post('/transfers', { fromWarehouseId: A, toWarehouseId: B, lines: [{ itemId: it, batchId: bA, qty: 30 }] });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'IN_TRANSIT');
    assert.match(res.body.docNo, new RegExp(`^XFR/${fyLabel()}/\\d{5}$`));
    assert.equal((await row(bA)).h, 20);
    const [[l]] = await pool.query("SELECT qty,value FROM stock_ledger WHERE doc_no=? AND movement='TRANSFER_OUT'", [res.body.docNo]);
    assert.deepEqual([Number(l.qty), Number(l.value)], [-30, 300]);
    const [[t1]] = await pool.query('SELECT status,value,pod_pending FROM stock_transfers WHERE id=?', [res.body.id]);
    assert.deepEqual([t1.status, Number(t1.value), t1.pod_pending], ['IN_TRANSIT', 300, 1]);

    const rec = await post(`/transfers/${res.body.id}/receive`);
    assert.equal(rec.status, 200);
    const [[dest]] = await pool.query('SELECT qty_on_hand h FROM batches WHERE item_id=? AND warehouse_id=?', [it, B]);
    assert.equal(Number(dest.h), 30);
    assert.equal((await row(bA)).h + Number(dest.h), 50, 'stock conserved');
  });

  await t.test('transfer cannot take reserved stock, and a rejected transfer leaves nothing behind', async () => {
    const before = (await pool.query('SELECT COUNT(*) n FROM stock_transfers WHERE from_warehouse_id=?', [A]))[0][0].n;
    const res = await post('/transfers', { fromWarehouseId: A, toWarehouseId: B, lines: [{ itemId: it, batchId: bA, qty: 15 }] });   // free is only 10
    assert.equal(res.status, 409);
    assert.equal((await row(bA)).h, 20);
    assert.equal((await pool.query('SELECT COUNT(*) n FROM stock_transfers WHERE from_warehouse_id=?', [A]))[0][0].n, before);
  });

  await t.test('transfer validation', async () => {
    assert.equal((await post('/transfers', { fromWarehouseId: A, toWarehouseId: A, lines: [{ itemId: it, batchId: bA, qty: 1 }] })).status, 422);
    assert.equal((await post('/transfers', { fromWarehouseId: A, toWarehouseId: B, lines: [] })).status, 422);
    assert.equal((await post('/transfers', { fromWarehouseId: A, toWarehouseId: B, lines: [{ itemId: it, batchId: bA, qty: 0 }] })).status, 422);
    assert.equal((await post('/transfers', { fromWarehouseId: A, toWarehouseId: B, lines: [{ itemId: it, batchId: bC, qty: 1 }] })).status, 422, "batch from another godown");
    assert.equal((await post('/transfers', { fromWarehouseId: A, toWarehouseId: 999999999, lines: [{ itemId: it, batchId: bA, qty: 1 }] })).status, 422);
  });

  await t.test('draft transfer keeps stock until it is sent, and can be sent only once', async () => {
    const d = await post('/transfers', { fromWarehouseId: A, toWarehouseId: B, issue: false, lines: [{ itemId: it, batchId: bA, qty: 4 }, { itemId: it, batchId: bA, qty: 3 }] });
    assert.equal(d.body.status, 'DRAFT');
    assert.equal((await row(bA)).h, 20, 'nothing moved');
    assert.equal((await pool.query('SELECT qty FROM stock_transfer_lines WHERE transfer_id=?', [d.body.id]))[0][0].qty, 7, 'same-batch lines merged');
    assert.equal((await post(`/transfers/${d.body.id}/issue`)).status, 200);
    assert.equal((await row(bA)).h, 13);
    assert.equal((await post(`/transfers/${d.body.id}/issue`)).status, 409);
    assert.equal((await row(bA)).h, 13, 'no double issue');
  });

  await t.test('adjustment is created pending with a dynamic-FY number, then approved and posted', async () => {
    const res = await post('/adjustments', { warehouseId: C, itemId: it, batchId: bC, qty: -2, reason: 'Damage', value: 20 });
    assert.equal(res.status, 201);
    assert.match(res.body.docNo, new RegExp(`^ADJ/${fyLabel()}/\\d{5}$`));
    assert.equal((await row(bC)).h, 5, 'nothing posted before approval');
    assert.equal((await post(`/adjustments/${res.body.id}/approve`)).status, 200);
    assert.equal((await row(bC)).h, 3);
    assert.equal((await post(`/adjustments/${res.body.id}/approve`)).status, 409);
  });

  await t.test('adjustment validation and reserved-stock guard', async () => {
    assert.equal((await post('/adjustments', { warehouseId: C, itemId: it, batchId: bA, qty: 1, reason: 'x' })).status, 422, 'batch of another godown');
    assert.equal((await post('/adjustments', { warehouseId: C, itemId: it, batchId: bC, qty: 0, reason: 'x' })).status, 422);
    assert.equal((await post('/adjustments', { warehouseId: C, itemId: it, batchId: bC, qty: 1 })).status, 422, 'reason required');
    const hold = await ins('INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,unit_cost,qty_on_hand,qty_reserved) VALUES (?,?,?,?,10,10,8)', [it, C, `${tag}-HOLD`, '2026-02-01']);
    const adj = await post('/adjustments', { warehouseId: C, itemId: it, batchId: hold, qty: -5, reason: 'Count correction' });
    const out = await post(`/adjustments/${adj.body.id}/approve`);
    assert.equal(out.status, 409);
    assert.match(out.body.error, /reserved/);
    assert.equal((await row(hold)).h, 10);
    const ok = await post('/adjustments', { warehouseId: C, itemId: it, batchId: hold, qty: -2, reason: 'Count correction' });
    assert.equal((await post(`/adjustments/${ok.body.id}/approve`)).status, 200);
    assert.equal((await row(hold)).h, 8);
  });
});
