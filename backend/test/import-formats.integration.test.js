import test from 'node:test';
import assert from 'node:assert/strict';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('bulk import formats: xlsx, json, google sheets', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { default: imports } = await import('../routes/imports.js');
  const { buildTemplate } = await import('../importFormats.js');
  const { pool } = await import('../db.js');
  const { ORG } = await import('../org.js');
  const tag = `F${Date.now()}`;
  const app = express();
  app.use(express.json());
  app.use(imports);
  t.after(async () => {
    await pool.query('DELETE FROM warehouses WHERE org_id=? AND name LIKE ?', [ORG, `${tag}%`]);
    await pool.query('DELETE FROM parties WHERE org_id=? AND name LIKE ?', [ORG, `${tag}%`]);
    await pool.end();
  });
  const cols = ['name', 'notes', 'allow_negative', 'default_uom', 'default_reorder', 'max_stock'];

  await t.test('serves xlsx and json templates', async () => {
    const x = await request(app).get('/imports/templates/items.xlsx?sample=1').buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal(x.status, 200);
    assert.equal(x.headers['content-type'], XLSX);
    assert.ok(x.body.length > 5000);
    const j = await request(app).get('/imports/templates/parties.json?sample=1');
    assert.equal(j.status, 200);
    assert.equal(j.body[0].party_type, 'CUSTOMER');
  });

  await t.test('uploads and commits an Excel workbook built from the template', async () => {
    const xlsx = await buildTemplate('WAREHOUSES', cols, ['name'], { sample: true });
    const up = await request(app).post('/imports?type=WAREHOUSES&filename=w.xlsx').set('Content-Type', XLSX).send(xlsx);
    assert.equal(up.status, 201);
    assert.equal(up.body.job.rows_total, 2);
    assert.equal(Number(up.body.counts.errors), 0);
    await pool.query("DELETE FROM warehouses WHERE org_id=? AND name LIKE 'Demo Godown%'", [ORG]);
  });

  await t.test('uploads JSON as an array and as {rows:[…]}', async () => {
    const a = await request(app).post('/imports?type=WAREHOUSES&filename=a.json').send([{ name: `${tag} J1`, default_uom: 'BAG' }, { name: `${tag} J2`, max_stock: 5, allow_negative: true }]);
    assert.equal(a.status, 201);
    assert.equal(Number(a.body.counts.errors), 0);
    const b = await request(app).post('/imports?type=PARTIES&filename=b.json').send({ rows: [{ name: `${tag} P1`, party_type: 'SUPPLIER' }] });
    assert.equal(b.status, 201);
    const commit = await request(app).post(`/imports/${a.body.job.id}/commit`);
    assert.equal(commit.body.posted, 2);
    const [[w]] = await pool.query('SELECT allow_negative,max_stock FROM warehouses WHERE org_id=? AND name=?', [ORG, `${tag} J2`]);
    assert.equal(w.allow_negative, 1);
    assert.equal(Number(w.max_stock), 5);
  });

  await t.test('rejects malformed JSON, bad workbooks and unsupported types', async () => {
    assert.equal((await request(app).post('/imports?type=WAREHOUSES').send({ nope: 1 })).status, 422);
    assert.equal((await request(app).post('/imports?type=WAREHOUSES').send(['x'])).status, 422);
    assert.equal((await request(app).post('/imports?type=WAREHOUSES').set('Content-Type', XLSX).send(Buffer.from('not a zip'))).status, 422);
    assert.equal((await request(app).post('/imports?type=WAREHOUSES').set('Content-Type', 'text/plain').send('name\nx')).status, 415);
  });

  const workbook = async (build) => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    build(wb);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const uploadXlsx = (buf) => request(app).post('/imports?type=WAREHOUSES&filename=Warehouses.xlsx').set('Content-Type', XLSX).send(buf);

  await t.test('real-world Excel files: friendly headers, title rows, data on a later sheet', async () => {
    // Title rows above the header, headers like "Godown Name" and "Default UOM *".
    const titled = await workbook((wb) => {
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(['Godown master list']);
      ws.addRow([]);
      ws.addRow(['Godown Name', 'Remarks', 'Default UOM *', 'Max Stock']);
      ws.addRow([`${tag} Titled`, 'north yard', 'bag', 250]);
    });
    const a = await uploadXlsx(titled);
    assert.equal(a.status, 201);
    assert.equal(a.body.job.rows_total, 1);
    assert.equal(Number(a.body.counts.errors), 0);

    // First sheet is unrelated; the data is on the second sheet.
    const second = await workbook((wb) => {
      wb.addWorksheet('Summary').addRow(['Report', 'generated today']);
      const ws = wb.addWorksheet('Godowns');
      ws.addRow(['name', 'notes']);
      ws.addRow([`${tag} Later`, 'x']);
    });
    const b = await uploadXlsx(second);
    assert.equal(b.status, 201);
    assert.equal(b.body.job.rows_total, 1);
  });

  await t.test('CSV with spaced headers is accepted too', async () => {
    const res = await request(app).post('/imports?type=WAREHOUSES&filename=g.csv').set('Content-Type', 'text/csv').send(`Warehouse Name,Reorder Level\n${tag} Csv,5\n`);
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.counts.errors), 0);
  });

  await t.test('error messages say what was wrong and what was found', async () => {
    const wrong = await workbook((wb) => { const ws = wb.addWorksheet('Data'); ws.addRow(['Place', 'Capacity']); ws.addRow(['A', 1]); });
    const miss = await uploadXlsx(wrong);
    assert.equal(miss.status, 422);
    assert.match(miss.body.error, /Missing required column: name\. Columns found: place, capacity/);

    const headerOnly = await workbook((wb) => wb.addWorksheet('Data').addRow(['name', 'notes']));
    const none = await uploadXlsx(headerOnly);
    assert.equal(none.status, 422);
    assert.match(none.body.error, /No data rows found/);
  });

  await t.test('maps common warehouse and party Excel headers to the canonical import contract', async () => {
    const { canonicalHeader } = await import('../importFormats.js');
    assert.equal(canonicalHeader('WAREHOUSES', 'Location'), 'notes');
    assert.equal(canonicalHeader('WAREHOUSES', 'Capacity'), 'max_stock');
    assert.equal(canonicalHeader('PARTIES', 'Contact'), 'mobile');
    assert.equal(canonicalHeader('PARTIES', 'Type'), 'party_type');
  });

  await t.test('imports from a shared Google Sheet link', async () => {
    const bad = await request(app).post('/imports/from-sheet').send({ type: 'WAREHOUSES', url: 'https://example.com/spreadsheets/d/abc' });
    assert.equal(bad.status, 422);
    assert.match(bad.body.error, /docs\.google\.com/);

    const realFetch = globalThis.fetch;
    const sheetId = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const xlsx = await buildTemplate('WAREHOUSES', cols, ['name'], { sample: false });
    let called;
    try {
      globalThis.fetch = async (url) => { called = String(url); return new Response(`name\n${tag} Sheet\n`, { status: 200, headers: { 'content-type': 'text/csv' } }); };
      const ok = await request(app).post('/imports/from-sheet').send({ type: 'WAREHOUSES', url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=77` });
      assert.equal(ok.status, 201);
      assert.equal(called, `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=77`);
      assert.equal(ok.body.job.filename, 'google-sheet');

      globalThis.fetch = async () => new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      const priv = await request(app).post('/imports/from-sheet').send({ type: 'WAREHOUSES', url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` });
      assert.equal(priv.status, 422);
      assert.match(priv.body.error, /Anyone with the link/);

      globalThis.fetch = async () => new Response(xlsx, { status: 200, headers: { 'content-type': XLSX } });
      const empty = await request(app).post('/imports/from-sheet').send({ type: 'WAREHOUSES', url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` });
      assert.equal(empty.status, 422); // blank template has no data rows
    } finally { globalThis.fetch = realFetch; }
  });
});
