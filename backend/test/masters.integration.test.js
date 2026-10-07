import test from 'node:test';
import assert from 'node:assert/strict';

test('single-entry master forms', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { default: masters } = await import('../routes/masters.js');
  const { pool } = await import('../db.js');
  const { ORG } = await import('../org.js');
  const tag = `M${Date.now()}`;
  const app = express();
  app.use(express.json());
  app.use(masters);
  t.after(async () => {
    await pool.query('DELETE FROM items WHERE org_id=? AND sku LIKE ?', [ORG, `${tag}%`]);
    await pool.query('DELETE FROM warehouses WHERE org_id=? AND name LIKE ?', [ORG, `${tag}%`]);
    await pool.query('DELETE FROM parties WHERE org_id=? AND name LIKE ?', [ORG, `${tag}%`]);
    await pool.end();
  });

  await t.test('lists units of measure', async () => {
    const res = await request(app).get('/uoms');
    assert.ok(res.body.rows.some((u) => u.code === 'NOS'));
  });

  await t.test('creates a warehouse, party and item', async () => {
    const wh = await request(app).post('/warehouses').send({ name: `${tag} WH`, default_uom: 'BAG', default_reorder: 10, max_stock: 100, allow_negative: false });
    assert.equal(wh.status, 201);
    const party = await request(app).post('/parties').send({ name: `${tag} Party`, party_type: 'SUPPLIER', mobile: '9876543210', credit_limit: 5000, preferred: true });
    assert.equal(party.status, 201);
    const item = await request(app).post('/items').send({ sku: `${tag}-1`, name: 'Form item', hsn: '2523', gst_rate: 28, base_uom: 'BAG', batch_tracked: true });
    assert.equal(item.status, 201);
    const [[row]] = await pool.query('SELECT hsn,gst_rate,base_uom,batch_tracked FROM items WHERE id=?', [item.body.id]);
    assert.equal(row.hsn, '2523');
    assert.equal(Number(row.gst_rate), 28);
    assert.equal(row.batch_tracked, 1);
  });

  await t.test('rejects invalid input with the field to fix', async () => {
    const bad = await request(app).post('/items').send({ sku: `${tag}-2`, name: 'Bad', hsn: '12', gst_rate: 18, base_uom: 'NOS' });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.field, 'hsn');
    const uom = await request(app).post('/warehouses').send({ name: `${tag} WH2`, default_uom: 'NOPE' });
    assert.equal(uom.status, 422);
    assert.equal(uom.body.field, 'default_uom');
  });

  await t.test('rejects duplicates', async () => {
    const dup = await request(app).post('/warehouses').send({ name: `${tag} WH` });
    assert.equal(dup.status, 422); // caught by validation (EXISTS)
    assert.equal(dup.body.kind, 'EXISTS');
  });
  await t.test('deletes records singly and in bulk, and protects records in use', async () => {
    const mk = async (path, body) => (await request(app).post(path).send(body)).body.id;
    const w = [await mk('/warehouses', { name: `${tag} DW1` }), await mk('/warehouses', { name: `${tag} DW2` })];
    const p = [await mk('/parties', { name: `${tag} DP1` }), await mk('/parties', { name: `${tag} DP2` })];
    const i = [await mk('/items', { sku: `${tag}-D1`, name: 'D1', hsn: '2523', gst_rate: 18, base_uom: 'NOS' }), await mk('/items', { sku: `${tag}-D2`, name: 'D2', hsn: '2523', gst_rate: 18, base_uom: 'NOS' })];

    // single delete, then the same id again is a 404
    for (const [path, ids] of [['warehouses', w], ['parties', p], ['items', i]]) {
      assert.equal((await request(app).delete(`/${path}/${ids[0]}`)).status, 200);
      assert.equal((await request(app).delete(`/${path}/${ids[0]}`)).status, 404);
    }

    // an item that holds a batch is protected; the others in the same bulk call still go
    await pool.query('INSERT INTO batches (item_id,warehouse_id,batch_no,unit_cost,qty_on_hand) VALUES (?,?,?,?,?)', [i[1], w[1], 'B1', 10, 5]);
    const blocked = await request(app).delete(`/items/${i[1]}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /cannot be deleted/);
    const bulkBlocked = await request(app).post('/warehouses/bulk-delete').send({ ids: [w[1]] });
    assert.equal(bulkBlocked.body.deleted, 0);
    assert.equal(bulkBlocked.body.failed, 1);

    await pool.query('DELETE FROM batches WHERE item_id=?', [i[1]]);
    const bulk = await request(app).post('/items/bulk-delete').send({ ids: [i[1], 99999999] });
    assert.equal(bulk.body.deleted, 1);
    assert.equal(bulk.body.failed, 1);
    assert.equal((await request(app).post('/parties/bulk-delete').send({ ids: [p[1]] })).body.deleted, 1);
    assert.equal((await request(app).post('/warehouses/bulk-delete').send({ ids: [w[1]] })).body.deleted, 1);
    assert.equal((await request(app).post('/items/bulk-delete').send({ ids: [] })).status, 422);
  });
  await t.test('edits items and parties, keeps keys unique and locks unit/valuation once stock exists', async () => {
    const item = (await request(app).post('/items').send({ sku: `${tag}-E1`, name: 'Edit me', hsn: '2523', gst_rate: 18, base_uom: 'NOS', valuation: 'FIFO' })).body.id;
    const other = (await request(app).post('/items').send({ sku: `${tag}-E2`, name: 'Other', hsn: '2523', gst_rate: 18, base_uom: 'NOS' })).body.id;
    const got = await request(app).get(`/items/${item}`);
    assert.equal(got.body.sku, `${tag}-E1`);
    assert.equal(got.body.batch_tracked, 'false');

    const ok = await request(app).patch(`/items/${item}`).send({ name: 'Edited', gst_rate: 5, brand: 'B' });
    assert.equal(ok.status, 200);
    const [[row]] = await pool.query('SELECT name,gst_rate,brand,sku FROM items WHERE id=?', [item]);
    assert.deepEqual([row.name, Number(row.gst_rate), row.brand, row.sku], ['Edited', 5, 'B', `${tag}-E1`]);
    assert.equal((await request(app).patch(`/items/${item}`).send({ sku: `${tag}-E1`, name: 'Same sku is fine' })).status, 200);
    const dup = await request(app).patch(`/items/${item}`).send({ sku: `${tag}-E2` });
    assert.equal(dup.status, 422);
    assert.equal(dup.body.field, 'sku');
    assert.equal((await request(app).patch(`/items/${item}`).send({ hsn: '12' })).status, 422);
    assert.equal((await request(app).patch('/items/99999999').send({ name: 'x' })).status, 404);

    const wh = (await request(app).post('/warehouses').send({ name: `${tag} EW` })).body.id;
    await pool.query('INSERT INTO batches (item_id,warehouse_id,batch_no,unit_cost,qty_on_hand) VALUES (?,?,?,?,?)', [item, wh, 'EB1', 10, 5]);
    const locked = await request(app).patch(`/items/${item}`).send({ base_uom: 'KG' });
    assert.equal(locked.status, 409);
    assert.equal((await request(app).patch(`/items/${item}`).send({ name: 'Still editable' })).status, 200);
    await pool.query('DELETE FROM batches WHERE item_id=?', [item]);
    assert.equal((await request(app).patch(`/items/${item}`).send({ base_uom: 'KG' })).status, 200);

    const party = (await request(app).post('/parties').send({ name: `${tag} EP`, mobile: '9876543210' })).body.id;
    const p = await request(app).patch(`/parties/${party}`).send({ party_type: 'SUPPLIER', credit_limit: 1000, mobile: '+91 98765 11111' });
    assert.equal(p.status, 200);
    const [[prow]] = await pool.query('SELECT party_type,credit_limit,mobile FROM parties WHERE id=?', [party]);
    assert.deepEqual([prow.party_type, Number(prow.credit_limit), prow.mobile], ['SUPPLIER', 1000, '9876511111']);
    assert.equal((await request(app).patch(`/parties/${party}`).send({ gstin: 'BAD' })).status, 422);
    await request(app).post('/warehouses/bulk-delete').send({ ids: [wh] });
  });
});
