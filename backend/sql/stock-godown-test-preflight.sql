-- PrimeBiller stock/godown test preflight
--
-- SAFE TO RUN against the existing application database:
--   * read-only (no INSERT/UPDATE/DELETE/ALTER)
--   * verifies the schema required by the godown/stock test suite
--   * reports the current database and important row counts
--
-- IMPORTANT:
--   The Node test suite creates its own scratch databases for schema tests and
--   cleans up its fixture rows. Do NOT point DATABASE_URL at production.
--
-- Usage from the MySQL client:
--   mysql --host=HOST --port=3306 --user=USER -p DATABASE < backend/sql/stock-godown-test-preflight.sql

SELECT DATABASE() AS database_name, VERSION() AS mysql_version;

SELECT
  'organizations' AS table_name,
  COUNT(*) AS present
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'organizations'
UNION ALL SELECT 'warehouses', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'warehouses'
UNION ALL SELECT 'items', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'items'
UNION ALL SELECT 'batches', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'batches'
UNION ALL SELECT 'stock_ledger', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'stock_ledger'
UNION ALL SELECT 'stock_transfers', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'stock_transfers'
UNION ALL SELECT 'stock_transfer_lines', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'stock_transfer_lines'
UNION ALL SELECT 'stock_adjustments', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'stock_adjustments'
UNION ALL SELECT 'item_warehouse_settings', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'item_warehouse_settings';

SELECT
  column_name,
  column_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'warehouses'
  AND column_name IN ('id','org_id','name','active','allow_negative','default_uom','default_reorder','max_stock')
ORDER BY ordinal_position;

SELECT
  'warehouses' AS source,
  COUNT(*) AS total,
  SUM(active = 1) AS active,
  SUM(active = 0) AS inactive
FROM warehouses;

SELECT
  'stock coverage' AS source,
  COUNT(DISTINCT b.item_id) AS items_with_batches,
  COUNT(DISTINCT CASE WHEN b.qty_on_hand > 0 THEN b.item_id END) AS items_with_positive_stock,
  COUNT(DISTINCT CASE WHEN b.qty_on_hand = 0 THEN b.item_id END) AS items_with_zero_batch_stock
FROM batches b;

SELECT
  'in_transit_transfers' AS source,
  COUNT(*) AS total
FROM stock_transfers
WHERE status = 'IN_TRANSIT';

SELECT
  'required_schema_columns' AS check_name,
  CASE WHEN COUNT(*) = 8 THEN 'PASS' ELSE 'FAIL' END AS result
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'warehouses'
  AND column_name IN ('id','org_id','name','active','allow_negative','default_uom','default_reorder','max_stock');