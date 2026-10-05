import "dotenv/config";
import { pool } from "./db.js";

const c = await pool.getConnection();
const ex = (sql, params = []) => c.query(sql, params).then((r) => r[0]);

try {
  const [[org]] = await c.query("SELECT id FROM organizations ORDER BY id LIMIT 1");
  if (!org) throw new Error("Run seed-data.js before seed-pending-data.js");

  // Demo-only presentation defaults used by the supplied mock screens.
  await ex(
    "UPDATE organizations SET require_credit_override=1,require_batch_reason=1,eway_threshold=50000 WHERE id=?",
    [org.id],
  );

  await ex(
    "UPDATE warehouses SET active=1,default_uom=CASE name WHEN 'Balanagar Godown' THEN 'BAG' WHEN 'Jeedimetla Yard' THEN 'CFT' ELSE 'NOS' END,
      default_reorder=CASE name WHEN 'Balanagar Godown' THEN 500 WHEN 'Jeedimetla Yard' THEN 100 ELSE 60 END,
      max_stock=CASE name WHEN 'Balanagar Godown' THEN 3000 WHEN 'Jeedimetla Yard' THEN 800 ELSE 400 END,
      active_skus=CASE name WHEN 'Balanagar Godown' THEN 1421 WHEN 'Jeedimetla Yard' THEN 386 ELSE 214 END
      WHERE org_id=?",
    [org.id],
  );

  await ex("UPDATE parties SET party_type=CASE WHEN name IN ('UltraTech Cement','Century Ply') THEN 'SUPPLIER' ELSE 'CUSTOMER' END,
      status=CASE WHEN name='Rajesh Constructions' THEN 'CREDIT_WATCH' ELSE 'ACTIVE' END,
      preferred=CASE WHEN name IN ('UltraTech Cement','Century Ply') THEN 1 ELSE 0 END
      WHERE org_id=?", [org.id]);

  // Expand the party master to the counts shown in the reference screen.
  const [[cc]] = await c.query("SELECT COUNT(*) n FROM parties WHERE org_id=? AND party_type='CUSTOMER'", [org.id]);
  for (let i = Number(cc.n) + 1; i <= 186; i++) {
    const gstin = i <= 175 ? `36DUMMYSTORE\${String(i).padStart(2,'0')}`.slice(0,15) : null;
    const status = i <= 7 ? 'ON_HOLD' : 'ACTIVE';
    await ex(
      "INSERT INTO parties (org_id,name,gstin,mobile,credit_limit,party_type,status,preferred) VALUES (?,?,?,?,?,'CUSTOMER',?,0)",
      [org.id, `Customer \${String(i).padStart(3,'0')}`, gstin, `90000\${String(10000+i).slice(-5)}`, 200000, status],
    );
  }
  const [[sc]] = await c.query("SELECT COUNT(*) n FROM parties WHERE org_id=? AND party_type='SUPPLIER'", [org.id]);
  for (let i = Number(sc.n) + 1; i <= 72; i++) {
    await ex(
      "INSERT INTO parties (org_id,name,gstin,mobile,credit_limit,party_type,status,preferred) VALUES (?,?,?,?,0,'SUPPLIER','ACTIVE',?)",
      [org.id, `Supplier \${String(i).padStart(3,'0')}`, `36SUPPLIER\${String(i).padStart(4,'0')}`.slice(0,15), `91000\${String(10000+i).slice(-5)}`, i <= 14 ? 1 : 0],
    );
  }

  await ex("DELETE FROM stock_transfer_lines");
  await ex("DELETE FROM stock_transfers");
  await ex("DELETE FROM stock_adjustments");

  const [[b]] = await c.query("SELECT id FROM warehouses WHERE org_id=? AND name='Balanagar Godown'", [org.id]);
  const [[j]] = await c.query("SELECT id FROM warehouses WHERE org_id=? AND name='Jeedimetla Yard'", [org.id]);
  const [[s]] = await c.query("SELECT id FROM warehouses WHERE org_id=? AND name='Shop Counter'", [org.id]);

  const [[konark]] = await c.query("SELECT id FROM items WHERE sku='CEM-KN-DSP-50'");
  const [[tmt12]] = await c.query("SELECT id FROM items WHERE sku='STL-TMT-12'");
  const [[cen]] = await c.query("SELECT id FROM items WHERE sku='PLY-CEN-BWP-19'");
  const [[sand]] = await c.query("SELECT id FROM items WHERE sku='AGG-SAND-W'");
  const [[pipe]] = await c.query("SELECT id FROM items WHERE sku='PIP-AST-CPVC-1'");
  const [[adh]] = await c.query("SELECT id FROM items WHERE sku='ADH-FVC-SH-5'");

  const [kb] = await c.query("SELECT id FROM batches WHERE item_id=? AND warehouse_id=? ORDER BY id LIMIT 1", [konark.id,b]);
  const [tb] = await c.query("SELECT id FROM batches WHERE item_id=? AND warehouse_id=? ORDER BY id LIMIT 1", [tmt12.id,b]);
  const [cb] = await c.query("SELECT id FROM batches WHERE item_id=? AND warehouse_id=? ORDER BY id LIMIT 1", [cen.id,j]);
  const [sb] = await c.query("SELECT id FROM batches WHERE item_id=? AND warehouse_id=? ORDER BY id LIMIT 1", [sand.id,b]);
  const [ab] = await c.query("SELECT id FROM batches WHERE item_id=? AND warehouse_id=? ORDER BY id LIMIT 1", [adh.id,s]);

  const transferDefs = [
    ['00031', j.id,b.id,'2026-09-22 09:05','IN_TRANSIT',142880,1],
    ['00030', b.id,s.id,'2026-09-21 12:15','COMPLETED',48200,0],
    ['00029', b.id,j.id,'2026-09-20 10:05','COMPLETED',218400,0],
    ['00028', s.id,b.id,'2026-09-18 14:22','DRAFT',64900,0],
    ['00027', j.id,s.id,'2026-09-17 09:20','COMPLETED',22610,0],
  ];
  for (const [no,from,to,date,status,value,pod] of transferDefs) {
    const [ins] = await c.query(
      "INSERT INTO stock_transfers (org_id,doc_no,from_warehouse_id,to_warehouse_id,transfer_date,status,value,pod_pending) VALUES (?,?,?,?,?,?,?,?)",
      [org.id,`XFR/25-26/\${no}`,from,to,date,status,value,pod],
    );
    if (no === '00031') {
      await ex("INSERT INTO stock_transfer_lines (transfer_id,item_id,batch_id,qty,rate) VALUES (?,?,?,?,?)",( [ins.insertId,konark.id,kb[0]?.id || null,250,370] ));
      await ex("INSERT INTO stock_transfer_lines (transfer_id,item_id,batch_id,qty,rate) VALUES (?,?,?,?,?)",( [ins.insertId,tmt12.id,tb[0]?.id || null,0.5,58400] ));
    } else {
      await ex("INSERT INTO stock_transfer_lines (transfer_id,item_id,batch_id,qty,rate) VALUES (?,?,?,?,?)",( [ins.insertId,cen.id,cb[0]?.id || null,1,3150] ));
    }
  }

  // Fill completed-transfer history to match the reference count of 41.
  const [[tc]] = await c.query("SELECT COUNT(*) n FROM stock_transfers WHERE org_id=? AND status='COMPLETED'", [org.id]);
  for (let i = Number(tc.n) + 1; i <= 41; i++) {
    await ex(
      "INSERT INTO stock_transfers (org_id,doc_no,from_warehouse_id,to_warehouse_id,transfer_date,status,value,pod_pending) VALUES (?,?,?,?,?,'COMPLETED',?,0)",
      [org.id,`XFR/25-26/9\${String(i).padStart(3,'0')}`,b.id,j.id,`2026-09-\${String((i % 20)+1).padStart(2,'0')} 09:00:00`,30000 + i * 1000],
    );
  }

  const adjustmentDefs = [
    ['00012',b.id,sand.id,sb[0]?.id,'Physical count',-3.4,-4760,'POSTED'],
    ['00011',j.id,cen.id,cb[0]?.id,'Damaged sheet',-4,-12600,'PENDING'],
    ['00010',s.id,pipe.id,(await c.query("SELECT id FROM batches WHERE item_id=? AND warehouse_id=? ORDER BY id LIMIT 1",[pipe.id,s.id]))[0][0]?.id,'Count surplus',8,3920,'POSTED'],
    ['00009',b.id,konark.id,kb[0]?.id,'Expiry write-down',-12,-4440,'POSTED'],
    ['00008',s.id,adh.id,ab[0]?.id,'Opening correction',60,28800,'PENDING'],
  ];
  for (const [no,wid,itemId,batchId,reason,qty,value,status] of adjustmentDefs) {
    if (!batchId) continue;
    await ex(
      "INSERT INTO stock_adjustments (org_id,doc_no,warehouse_id,item_id,batch_id,adjustment_date,reason,qty,value,status,submitted_by,submitted_at) VALUES (?,?,?,?,?,? ,?,?,?,?,?,?)",
      [org.id,`ADJ/25-26/\${no}`,wid,itemId,batchId,
       no==='00011'?'2026-09-21 16:18:00':no==='00012'?'2026-09-22 08:31:00':`2026-09-\${String(22-Number(no)+12).padStart(2,'0')} 10:00:00`,
       reason,qty,value,status,'Harish K.','2026-09-21 16:18:00'],
    );
  }

  console.log("Pending screen demo data seeded.");
} finally {
  c.release();
  await pool.end();
}
