import test from 'node:test';
import assert from 'node:assert/strict';

test('pending screen API integration suite', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express = (await import('express')).default;
  const request = (await import('supertest')).default;
  const { default: pending } = await import('../routes/pending.js');
  const { pool } = await import('../db.js');

  t.after(async () => { await pool.end(); });

  const app=express();
  app.use(express.json());
  app.use(pending);

  await t.test('returns warehouses, parties, reports and settings', async()=>{
    for(const path of ['/warehouses/list','/parties/list','/reports','/settings']){
      const res=await request(app).get(path);
      assert.equal(res.status,200,path);
      assert.equal(typeof res.body,'object');
    }
  });

  await t.test('transfer and adjustment screens expose real seeded rows', async()=>{
    const transfers=await request(app).get('/transfers');
    assert.equal(transfers.status,200);
    assert.ok(Array.isArray(transfers.body.rows));
    assert.ok(transfers.body.rows.length>=5);

    const adjustments=await request(app).get('/adjustments');
    assert.equal(adjustments.status,200);
    assert.ok(Array.isArray(adjustments.body.rows));
    assert.ok(adjustments.body.rows.length>=5);
  });

  await t.test('in-transit transfer receipt posts destination stock transactionally', async()=>{
    const first=await request(app).get('/transfers');
    const row=first.body.rows.find(x=>x.status==='IN_TRANSIT');
    assert.ok(row,'seeded in-transit transfer not found');
    const before=await request(app).get('/transfers?id='+row.id);
    assert.equal(before.body.selected.status,'IN_TRANSIT');
    const res=await request(app).post('/transfers/'+row.id+'/receive').send({});
    assert.equal(res.status,200);
    const after=await request(app).get('/transfers?id='+row.id);
    assert.equal(after.body.selected.status,'COMPLETED');
  });
});
