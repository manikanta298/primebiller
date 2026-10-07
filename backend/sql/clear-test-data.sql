-- Deletes test data. Same effect as `npm run data:clear` and Settings > Data & backup.
-- THIS PERMANENTLY DELETES ROWS. Take a backup first if there is anything you want to keep.
-- Always kept: organizations, uoms, app_users, app_sessions.
-- Child tables are deleted before parents so foreign keys never block it.
-- If a pending-screen table does not exist yet (npm run db:migrate not run), delete its line.
--
-- Step 1: transactions and stock (keeps items, parties and godowns).

START TRANSACTION;
DELETE FROM stock_transfer_lines;
DELETE FROM stock_transfers;
DELETE FROM stock_adjustments;
DELETE FROM import_rows;
DELETE FROM import_jobs;
DELETE FROM so_reservations;
DELETE FROM stock_alerts;
DELETE FROM receipt_allocations;
DELETE FROM receipts;
DELETE FROM invoices;
DELETE FROM eway_bills;
DELETE FROM challan_events;
DELETE FROM challan_lines;
DELETE FROM challans;
DELETE FROM sales_order_lines;
DELETE FROM sales_orders;
DELETE FROM doc_counters;
DELETE FROM stock_ledger;
DELETE FROM batches;
DELETE FROM item_warehouse_settings;
COMMIT;

-- Step 2 (optional): also remove the masters. Remove the leading "-- " from the next five lines to run it.
-- START TRANSACTION;
-- DELETE FROM item_uoms;
-- DELETE FROM items;
-- DELETE FROM parties;
-- DELETE FROM warehouses;
-- COMMIT;
