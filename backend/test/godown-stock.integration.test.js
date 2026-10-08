import test from 'node:test';
import assert from 'node:assert/strict';

test('godown dashboard: zero-stock visibility and inactive state', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { default: godownStock } = await import('../routes/godownStock.js');
  const { pool } = await import('../db.js');
  const { ORG } = await import('../org.js');
  const tag = 'GD' + Date.now();
  const app = express(); app.use(express.json()); app.use(godownStock);
  const ids = { w: [], i: [] };
  const ins = async (sql, a) => (await pool.query(sql, a))[0].insertId;

  t.after(async () => {
    if (ids.w.length) await pool.query('DELETE FROM stock_alerts WHERE warehouse_id IN (?)', [ids.w]);
    if (ids.i.length) {
      await pool.query('DELETE FROM stock_ledger WHERE item_id IN (?)', [ids.i]);
      await pool.query('DELETE FROM batches WHERE item_id IN (?)', [ids.i]);
      await pool.query('DELETE FROM item_warehouse_settings WHERE item_id IN (?)', [ids.i]);
      await pool.query('DELETE FROM items WHERE id IN (?)', [ids.i]);
    }
    if (ids.w.length) await pool.query('DELETE FROM warehouses WHERE id IN (?)', [ids.w]);
    await pool.end();
  });

  const w = await ins('INSERT INTO warehouses (org_id,name) VALUES (?,?)', [ORG, tag + ' warehouse']); ids.w.push(w);
  const item = await ins("INSERT INTO items (org_id,sku,name,hsn,gst_rate,base_uom) VALUES (?,?,?,?,18,'NOS')", [ORG, tag + '-SKU', 'Zero stock test item', '2523']); ids.i.push(item);
  await ins('INSERT INTO batches (item_id,warehouse_id,batch_no,mfg_date,unit_cost,qty_on_hand,qty_reserved) VALUES (?,?,?,?,10,0,0)', [item,w,tag + '-B','2026-01-01']);

  await t.test('dashboard includes zero stock item', async () => {
    const res = await request(app).get('/warehouses/' + w + '/dashboard');
    assert.equal(res.status, 200);
    assert.equal(res.body.stock.find((x) => x.item_id === item)?.stock_status, 'ZERO');
    assert.ok(Number(res.body.kpis.zero_skus) >= 1);
  });

  await t.test('inactive status is visible and can be reactivated', async () => {
    const off = await request(app).patch('/warehouses/' + w + '/status').send({ active:false });
    assert.equal(off.status, 200);
    assert.equal(off.body.active, false);
    const dash = await request(app).get('/warehouses/' + w + '/dashboard');
    assert.equal(dash.body.warehouse.active, 0);
    const on = await request(app).patch('/warehouses/' + w + '/status').send({ active:true });
    assert.equal(on.status, 200);
    assert.equal(on.body.active, true);
  });
});