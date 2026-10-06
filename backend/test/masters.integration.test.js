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
});
