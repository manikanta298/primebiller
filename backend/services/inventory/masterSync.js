import { ORG } from "../../org.js";

// Inventory sync (spec §32). Keeps item_warehouse_settings in step with the Item and Godown masters.
// Only configuration rows are created, never stock. INSERT IGNORE makes every call idempotent and
// never overwrites settings a user already edited. Pass the caller's connection so the sync commits
// or rolls back together with the master record.
//
// The source rows are read with a plain SELECT (no locks) and inserted in id order. A single
// INSERT ... SELECT would lock the godown/item rows it reads and could deadlock with concurrent
// godown or item activity; this form takes locks only on the rows being inserted, in a fixed order.
const CHUNK = 500;
const insertRows = async (c, rows) => {
  for (let i = 0; i < rows.length; i += CHUNK)
    await c.query("INSERT IGNORE INTO item_warehouse_settings (item_id,warehouse_id,reorder_point,max_qty) VALUES ?", [rows.slice(i, i + CHUNK)]);
};

// New item: one settings row per active godown, seeded from the godown defaults.
export async function syncSettingsForItem(c, itemId) {
  const [whs] = await c.query("SELECT id,default_reorder,max_stock FROM warehouses WHERE org_id=? AND active=1 ORDER BY id", [ORG]);
  await insertRows(c, whs.map((w) => [itemId, w.id, w.default_reorder, w.max_stock]));
}

// New godown: one settings row per existing item of the same organisation.
export async function syncSettingsForWarehouse(c, warehouseId) {
  const [[w]] = await c.query("SELECT id,default_reorder,max_stock FROM warehouses WHERE id=? AND org_id=? AND active=1", [warehouseId, ORG]);
  if (!w) return;
  const [items] = await c.query("SELECT id FROM items WHERE org_id=? ORDER BY id", [ORG]);
  await insertRows(c, items.map((i) => [i.id, w.id, w.default_reorder, w.max_stock]));
}
