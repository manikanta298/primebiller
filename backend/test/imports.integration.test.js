import test from 'node:test';
import assert from 'node:assert/strict';

const WH_HEAD = 'name,notes,allow_negative,default_uom,default_reorder,max_stock';
const PARTY_HEAD = 'name,party_type,gstin,mobile,credit_limit,terms,status,preferred';

test('typed master imports', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { default: imports } = await import('../routes/imports.js');
  const { pool } = await import('../db.js');
  const { ORG } = await import('../org.js');
  const tag = `T${Date.now()}`;
  const post = (type, csv) => request(app).post(`/imports?type=${type}&filename=${type}.csv`).set('Content-Type', 'text/csv').send(csv);

  const app = express();
  app.use(express.json());
  app.use(imports);

  t.after(async () => {
    await pool.query('DELETE FROM item_warehouse_settings WHERE warehouse_id IN (SELECT id FROM warehouses WHERE org_id=? AND name LIKE ?)', [ORG, `${tag}%`]);
    await pool.query('DELETE FROM warehouses WHERE org_id=? AND name LIKE ?', [ORG, `${tag}%`]);
    await pool.query('DELETE FROM parties WHERE org_id=? AND name LIKE ?', [ORG, `${tag}%`]);
    await pool.end();
  });

  await t.test('templates expose separate headers', async () => {
    for (const [type, header] of [['items', 'sku,name,hsn,gst_rate,base_uom'], ['warehouses', 'name,notes,allow_negative,default_uom'], ['parties', 'name,party_type,gstin,mobile']]) {
      const res = await request(app).get('/imports/templates/' + type + '.csv');
      assert.equal(res.status, 200);
      assert.ok(res.text.startsWith(header));
    }
  });

  await t.test('validation reports the specific error and the field to fix', async () => {
    const party = await post('PARTIES', `${PARTY_HEAD}\n${tag} Bad,BAD,notgst,123,abc,Net 30,BAD,no\n`);
    assert.equal(party.status, 201);
    assert.equal(Number(party.body.counts.errors), 1);
    const rows = await request(app).get(`/imports/${party.body.job.id}/rows`);
    assert.equal(rows.body[0].error_kind, 'TYPE');
    assert.equal(rows.body[0].error_field, 'party_type');

    const wh = await post('WAREHOUSES', `${WH_HEAD}\n${tag} Bad,note,false,BAG,10,5\n`);
    assert.equal(Number(wh.body.counts.errors), 1);
    const whRows = await request(app).get(`/imports/${wh.body.job.id}/rows`);
    assert.equal(whRows.body[0].error_kind, 'RANGE');
    assert.equal(whRows.body[0].error_field, 'max_stock');
  });

  await t.test('accepts a UTF-8 BOM and omitted optional columns', async () => {
    const res = await post('WAREHOUSES', `\uFEFFname\n${tag} Bom\n`);
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.counts.errors), 0);
  });

  await t.test('empty or header-only files return a clean 422', async () => {
    assert.equal((await post('WAREHOUSES', '')).status, 422);
    assert.equal((await post('WAREHOUSES', 'name\n')).status, 422);
    const missing = await post('ITEMS', 'name\nX\n');
    assert.equal(missing.status, 422);
    assert.match(missing.body.error, /Missing required columns: sku/);
  });

  await t.test('editing a row cannot introduce an in-file duplicate', async () => {
    const res = await post('WAREHOUSES', `name\n${tag} A\n${tag} B\n${tag} B\n`);
    assert.equal(Number(res.body.counts.errors), 1); // third row is a duplicate
    const id = res.body.job.id;
    const patch = await request(app).patch(`/imports/${id}/rows/3`).send({ field: 'name', value: `${tag} A` });
    assert.equal(patch.status, 422);
    assert.match(patch.body.error, /Duplicate/);
    const ok = await request(app).patch(`/imports/${id}/rows/3`).send({ field: 'name', value: `${tag} C` });
    assert.equal(ok.status, 200);
    assert.equal(Number(ok.body.counts.errors), 0);
  });

  await t.test('concurrent commits import each row exactly once', async () => {
    const res = await post('PARTIES', `${PARTY_HEAD}\n${tag} Once,CUSTOMER,,9876543210,100,Net 30,ACTIVE,false\n`);
    const id = res.body.job.id;
    const results = await Promise.all([1, 2, 3].map(() => request(app).post(`/imports/${id}/commit`)));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 2);
    const [{ n }] = (await pool.query('SELECT COUNT(*) n FROM parties WHERE org_id=? AND name=?', [ORG, `${tag} Once`]))[0];
    assert.equal(Number(n), 1);
  });

  await t.test('commit refuses rows that now exist and imports nothing', async () => {
    const res = await post('WAREHOUSES', `name\n${tag} Late\n`);
    await pool.query('INSERT INTO warehouses (org_id,name) VALUES (?,?)', [ORG, `${tag} Late`]);
    const commit = await request(app).post(`/imports/${res.body.job.id}/commit`);
    assert.equal(commit.status, 409);
    assert.equal(commit.body.posted, 0);
  });
});
