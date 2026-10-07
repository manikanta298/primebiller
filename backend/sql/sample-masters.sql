-- Dummy godowns, parties and items for trying the app. Safe to run more than once:
-- each row is skipped if one with the same name / SKU already exists.
-- Requires sql/reference-data.sql first. Every dummy row starts with "Demo" / "DEMO-"
-- so it is easy to spot; remove them with `npm run data:clear -- --scope=all --yes`
-- or the "Delete test data" section in Settings > Data & backup.

SET @org := (SELECT MIN(id) FROM organizations);

INSERT INTO warehouses (org_id, name, notes, allow_negative, default_uom, default_reorder, max_stock)
SELECT @org, v.name, v.notes, v.allow_negative, v.default_uom, v.default_reorder, v.max_stock
FROM (
  SELECT 'Demo Godown A' AS name, 'Main yard' AS notes, 0 AS allow_negative, 'BAG' AS default_uom, 100 AS default_reorder, 1000 AS max_stock
  UNION ALL SELECT 'Demo Godown B', 'Overflow', 1, 'NOS', 10, 500
  UNION ALL SELECT 'Demo Shop Counter', 'Fittings and hardware', 1, 'NOS', 5, NULL
) v
WHERE @org IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.org_id = @org AND LOWER(TRIM(w.name)) = LOWER(v.name));

INSERT INTO parties (org_id, name, gstin, mobile, credit_limit, terms, party_type, status, preferred)
SELECT @org, v.name, v.gstin, v.mobile, v.credit_limit, v.terms, v.party_type, v.status, v.preferred
FROM (
  SELECT 'Demo Customer Traders' AS name, '36ABCDE1234F1Z5' AS gstin, '9876543210' AS mobile, 50000 AS credit_limit, 'Net 30' AS terms, 'CUSTOMER' AS party_type, 'ACTIVE' AS status, 0 AS preferred
  UNION ALL SELECT 'Demo Contractor Works', NULL, '9876500001', 150000, 'Net 15', 'CUSTOMER', 'CREDIT_WATCH', 0
  UNION ALL SELECT 'Demo Supplier Cements', NULL, '9123456780', 0, 'Net 15', 'SUPPLIER', 'ACTIVE', 1
  UNION ALL SELECT 'Demo Steel Mart', '36AAAAA0000A1Z5', '9123400002', 0, 'Net 30', 'SUPPLIER', 'ON_HOLD', 0
) v
WHERE @org IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM parties p WHERE p.org_id = @org AND LOWER(TRIM(p.name)) = LOWER(v.name));

INSERT INTO items (org_id, sku, name, brand, category, hsn, gst_rate, base_uom, batch_tracked, valuation)
SELECT @org, v.sku, v.name, v.brand, v.category, v.hsn, v.gst_rate, v.base_uom, v.batch_tracked, v.valuation
FROM (
  SELECT 'DEMO-CEM-50' AS sku, 'Demo cement 50kg bag' AS name, 'DemoBrand' AS brand, 'Cement' AS category, '2523' AS hsn, 28.0 AS gst_rate, 'BAG' AS base_uom, 1 AS batch_tracked, 'FIFO' AS valuation
  UNION ALL SELECT 'DEMO-TMT-12', 'Demo TMT bar 12mm', NULL, 'Steel', '7214', 18.0, 'MT', 1, 'WAVG'
  UNION ALL SELECT 'DEMO-SAND-1', 'Demo river sand', NULL, 'Aggregates', '2505', 5.0, 'CFT', 0, 'FIFO'
  UNION ALL SELECT 'DEMO-PLY-18', 'Demo plywood 18mm', NULL, 'Timber', '4412', 18.0, 'SHEET', 0, 'FIFO'
  UNION ALL SELECT 'DEMO-PIPE-1', 'Demo PVC pipe 1 inch', NULL, 'Plumbing', '3917', 18.0, 'NOS', 0, 'FIFO'
) v
WHERE @org IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM items i WHERE i.org_id = @org AND i.sku = v.sku);
