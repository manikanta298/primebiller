import test from 'node:test';
import assert from 'node:assert/strict';

test('typed master imports', { skip: !process.env.DATABASE_URL }, async (t) => {
  const express=(await import('express')).default;
  const request=(await import('supertest')).default;
  const { default: imports }=await import('../routes/imports.js');
  const { pool }=await import('../db.js');
  t.after(async()=>{await pool.end();});
  const app=express();app.use(express.json());app.use(imports);

  await t.test('templates expose separate headers',async()=>{
    for(const [type,header] of [['items','sku,name,hsn,gst_rate,base_uom'],['warehouses','name,notes,allow_negative,default_uom'],['parties','name,party_type,gstin,mobile']]){
      const res=await request(app).get('/imports/templates/'+type+'.csv');
      assert.equal(res.status,200);assert.ok(res.text.startsWith(header));
    }
  });

  await t.test('validation catches invalid rows without committing them',async()=>{
    const party=await request(app).post('/imports?type=PARTIES&filename=bad-parties.csv').set('Content-Type','text/csv')
      .send('name,party_type,gstin,mobile,credit_limit,terms,status,preferred\nBad Party,BAD,notgst,123,abc,Net 30,BAD,no\n');
    assert.equal(party.status,201);assert.equal(Number(party.body.counts.errors),1);
    const warehouse=await request(app).post('/imports?type=WAREHOUSES&filename=bad-warehouses.csv').set('Content-Type','text/csv')
      .send('name,notes,allow_negative,default_uom,default_reorder,max_stock\nBad Warehouse,false,BAG,10,5\n');
    assert.equal(warehouse.status,201);assert.equal(Number(warehouse.body.counts.errors),1);
  });
});
