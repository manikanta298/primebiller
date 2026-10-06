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

  await t.test('party hold filter and adjustment batch validation enforce data integrity', async()=>{
    const held=await request(app).get('/parties/list?type=ON_HOLD');
    assert.equal(held.status,200);
    assert.ok(held.body.rows.length>0);
    assert.ok(held.body.rows.every((row)=>row.status==='ON_HOLD'));

    const [[pair]] = await pool.query(
      "SELECT a.id batch_id,b.item_id requested_item_id,a.warehouse_id FROM batches a JOIN batches b ON b.id<>a.id AND b.item_id<>a.item_id AND b.warehouse_id=a.warehouse_id LIMIT 1"
    );
    assert.ok(pair,'mismatched batch fixture not found');
    const invalid=await request(app).post('/adjustments').send({
      warehouseId:pair.warehouse_id,itemId:pair.requested_item_id,batchId:pair.batch_id,qty:1,reason:'validation test',value:1
    });
    assert.equal(invalid.status,422);
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

  await t.test('adjustment creation rejects a batch from another godown', async()=>{
    const [[batch]]=await pool.query(
      "SELECT b.id,b.item_id,b.warehouse_id FROM batches b JOIN warehouses w ON w.id=b.warehouse_id WHERE w.org_id=? LIMIT 1",
      [1],
    );
    const [[otherWarehouse]]=await pool.query(
      "SELECT id FROM warehouses WHERE org_id=? AND id<>? LIMIT 1",
      [1,batch.warehouse_id],
    );
    assert.ok(batch && otherWarehouse);
    const res=await request(app).post('/adjustments').send({
      warehouseId:otherWarehouse.id,
      itemId:batch.item_id,
      batchId:batch.id,
      qty:1,
      reason:'Integrity test',
      value:1,
    });
    assert.equal(res.status,422);
  });

  await t.test('in-transit transfer receipt posts destination stock transactionally', async()=>{
    const first=await request(app).get('/transfers');
    const row=first.body.rows.find(x=>x.status==='IN_TRANSIT');
    assert.ok(row,'seeded in-transit transfer not found');
    const before=await request(app).get('/transfers?id='+row.id);
    assert.equal(before.body.selected.status,'IN_TRANSIT');
    const sourceLine=before.body.selected.lines[0];
    const [[sourceBatch]]=await pool.query(
      "SELECT expiry_date FROM batches WHERE item_id=? AND warehouse_id=? AND batch_no=?",
      [sourceLine.item_id,before.body.selected.from_warehouse_id,sourceLine.batch_no],
    );
    assert.ok(sourceBatch,'seeded source batch must belong to the transfer origin');
    const res=await request(app).post('/transfers/'+row.id+'/receive').send({});
    assert.equal(res.status,200);
    const [[destinationBatch]]=await pool.query(
      "SELECT expiry_date FROM batches WHERE item_id=? AND warehouse_id=? AND batch_no=?",
      [sourceLine.item_id,before.body.selected.to_warehouse_id,sourceLine.batch_no],
    );
    assert.equal(destinationBatch.expiry_date?.toISOString?.() || destinationBatch.expiry_date, sourceBatch.expiry_date?.toISOString?.() || sourceBatch.expiry_date);
    const after=await request(app).get('/transfers?id='+row.id);
    assert.equal(after.body.selected.status,'COMPLETED');
  });
});
