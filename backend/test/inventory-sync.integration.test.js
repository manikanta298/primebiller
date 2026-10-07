import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('inventory sync keeps item_warehouse_settings in step with masters', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { default: masters } = await import('../routes/masters.js');
  const { pool } = await import('../db.js');
  const { ORG } = await import('../org.js');
  const tag = `S${Date.now()}`;
  const app = express();
  app.use(express.json());
  app.use(masters);
  const settings = async (where, args) => (await pool.query(`SELECT * FROM item_warehouse_settings WHERE ${where}`, args))[0];
  let otherOrg;
  t.after(async () => {
    const [items] = await pool.query('SELECT id FROM items WHERE sku LIKE ?', [`${tag}%`]);
    const [whs] = await pool.query('SELECT id FROM warehouses WHERE name LIKE ?', [`${tag}%`]);
    for (const { id } of items) await pool.query('DELETE FROM item_warehouse_settings WHERE item_id=?', [id]);
    for (const { id } of whs) await pool.query('DELETE FROM item_warehouse_settings WHERE warehouse_id=?', [id]);
    await pool.query('DELETE FROM items WHERE sku LIKE ?', [`${tag}%`]);
    await pool.query('DELETE FROM warehouses WHERE name LIKE ?', [`${tag}%`]);
    if (otherOrg) await pool.query('DELETE FROM organizations WHERE id=?', [otherOrg]);
    await pool.end();
  });

  const mkWh = async (name, extra = {}) => (await request(app).post('/warehouses').send({ name: `${tag} ${name}`, default_reorder: 7, max_stock: 70, ...extra })).body.id;
  const mkItem = async (n) => (await request(app).post('/items').send({ sku: `${tag}-${n}`, name: `Item ${n}`, hsn: '2523', gst_rate: 18, base_uom: 'NOS' })).body.id;

  const whA = await mkWh('A');
  const whOff = await mkWh('Off');
  await pool.query('UPDATE warehouses SET active=0 WHERE id=?', [whOff]);
  const [[{ id: orgRow }]] = [await pool.query('INSERT INTO organizations (name) VALUES (?)', [`${tag} org`]).then(([r]) => [{ id: r.insertId }])];
  otherOrg = orgRow;
  const [{ insertId: whOther }] = await pool.query('INSERT INTO warehouses (org_id,name,default_reorder) VALUES (?,?,?)', [otherOrg, `${tag} Other`, 1]);

  await t.test('new item gets settings for active godowns of its org only, seeded from godown defaults', async () => {
    const id = await mkItem(1);
    assert.ok(id);
    const rows = await settings('item_id=?', [id]);
    const byWh = Object.fromEntries(rows.map((r) => [r.warehouse_id, r]));
    assert.ok(byWh[whA]);
    assert.equal(Number(byWh[whA].reorder_point), 7);
    assert.equal(Number(byWh[whA].max_qty), 70);
    assert.equal(byWh[whOff], undefined, 'inactive godown skipped');
    assert.equal(byWh[whOther], undefined, 'other organisation skipped');
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM warehouses WHERE org_id=? AND active=1', [ORG]);
    assert.equal(rows.length, n);
  });

  await t.test('sync creates configuration only, never stock', async () => {
    const [[b]] = await pool.query('SELECT COUNT(*) n FROM batches b JOIN items i ON i.id=b.item_id WHERE i.sku LIKE ?', [`${tag}%`]);
    const [[l]] = await pool.query('SELECT COUNT(*) n FROM stock_ledger l JOIN items i ON i.id=l.item_id WHERE i.sku LIKE ?', [`${tag}%`]);
    assert.equal(b.n + l.n, 0);
  });

  await t.test('new godown gets settings for every item of the org, with its own defaults', async () => {
    const whB = await mkWh('B', { default_reorder: 3, max_stock: '' });
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM items WHERE org_id=?', [ORG]);
    const rows = await settings('warehouse_id=?', [whB]);
    assert.equal(rows.length, n);
    assert.ok(rows.every((r) => Number(r.reorder_point) === 3 && r.max_qty === null));
  });

  await t.test('failed create leaves no settings behind', async () => {
    const count = async () => (await pool.query('SELECT COUNT(*) n FROM item_warehouse_settings'))[0][0].n;
    const before = await count();
    const bad = await request(app).post('/items').send({ sku: `${tag}-1`, name: 'dup', hsn: '2523', gst_rate: 18, base_uom: 'NOS' });
    assert.equal(bad.status, 422);
    assert.equal(await count(), before);
  });

  await t.test('sync is idempotent and never overwrites edited settings', async () => {
    const id = await mkItem(2);
    await pool.query('UPDATE item_warehouse_settings SET reorder_point=99 WHERE item_id=? AND warehouse_id=?', [id, whA]);
    const { syncSettingsForItem } = await import('../services/inventory/masterSync.js');
    const c = await pool.getConnection();
    try { await syncSettingsForItem(c, id); await syncSettingsForItem(c, id); } finally { c.release(); }
    const [row] = await settings('item_id=? AND warehouse_id=?', [id, whA]);
    assert.equal(Number(row.reorder_point), 99);
    assert.equal((await settings('item_id=?', [id])).filter((r) => r.warehouse_id === whA).length, 1);
  });

  await t.test('deleting an item still removes its settings (Phase 1 delete unchanged)', async () => {
    const id = await mkItem(3);
    assert.ok((await settings('item_id=?', [id])).length > 0);
    const res = await request(app).delete(`/items/${id}`);
    assert.equal(res.status, 200);
    assert.equal((await settings('item_id=?', [id])).length, 0);
  });

  await t.test('backfill migration fills gaps and keeps existing rows', async () => {
    const id = await mkItem(4);
    await pool.query('UPDATE item_warehouse_settings SET reorder_point=55 WHERE item_id=? AND warehouse_id=?', [id, whA]);
    await pool.query('DELETE FROM item_warehouse_settings WHERE warehouse_id=? AND item_id IN (SELECT id FROM (SELECT id FROM items WHERE sku LIKE ?) x)', [whA, `${tag}-1`]);
    await pool.query('DELETE FROM item_warehouse_settings WHERE warehouse_id=?', [whOff]);
    const sql = fs.readFileSync(new URL('../migrations/0007_backfill_item_warehouse_settings.sql', import.meta.url), 'utf8')
      .split('\n').filter((l) => !l.startsWith('--')).join('\n');
    await pool.query(sql);
    const [[one]] = await pool.query('SELECT id FROM items WHERE sku=?', [`${tag}-1`]);
    assert.equal((await settings('item_id=? AND warehouse_id=?', [one.id, whA])).length, 1, 'gap refilled');
    const [kept] = await settings('item_id=? AND warehouse_id=?', [id, whA]);
    assert.equal(Number(kept.reorder_point), 55, 'edited row untouched');
    assert.equal((await settings('warehouse_id=?', [whOff])).length, 0);
    assert.equal((await settings('warehouse_id=?', [whOther])).length, 0);
  });
});
