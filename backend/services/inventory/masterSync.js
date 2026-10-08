import { ORG } from "../../org.js";

// Inventory sync (spec §32). Keeps item_warehouse_settings in step with the Item and Godown masters.
// Only configuration rows are created, never stock. INSERT IGNORE makes every call idempotent and
// never overwrites settings a user already edited. Pass the caller's connection so the sync commits
// or rolls back together with the master record.
const SEED = "INSERT IGNORE INTO item_warehouse_settings (item_id,warehouse_id,reorder_point,max_qty)";

// New item: one settings row per active godown, seeded from the godown defaults.
export const syncSettingsForItem = (c, itemId) =>
  c.query(`${SEED} SELECT ?,w.id,w.default_reorder,w.max_stock FROM warehouses w WHERE w.org_id=? AND w.active=1`, [itemId, ORG]);

// New godown: one settings row per existing item of the same organisation.
export const syncSettingsForWarehouse = (c, warehouseId) =>
  c.query(`${SEED} SELECT i.id,w.id,w.default_reorder,w.max_stock FROM items i JOIN warehouses w ON w.id=? AND w.org_id=i.org_id AND w.active=1 WHERE i.org_id=?`, [warehouseId, ORG]);
