-- backfill item warehouse settings
-- Data-only: no schema change, so nothing to mirror in sql/unified-schema.sql.

-- Backfill (spec section 34, step 6): every item gets a settings row for every active godown of its
-- organisation, seeded from the godown defaults. Existing rows are left untouched.
INSERT IGNORE INTO item_warehouse_settings (item_id, warehouse_id, reorder_point, max_qty)
SELECT i.id, w.id, w.default_reorder, w.max_stock
FROM items i JOIN warehouses w ON w.org_id = i.org_id AND w.active = 1;
