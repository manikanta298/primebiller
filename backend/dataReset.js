import { pool } from "./db.js";

// Delete order is child-before-parent so foreign keys never block it.
// "transactions" clears documents and stock but keeps item, party and godown masters.
// "all" also clears those masters. Organization, units of measure and user accounts are always kept.
const TRANSACTION_TABLES = [
  "stock_transfer_lines", "stock_transfers", "stock_adjustments", "import_rows", "import_jobs",
  "stock_alerts", "receipt_allocations", "receipts", "invoices", "eway_bills", "challan_events",
  "challan_lines", "challans", "sales_order_lines", "sales_orders", "doc_counters",
  "stock_ledger", "batches", "item_warehouse_settings",
];
const MASTER_TABLES = ["item_uoms", "items", "parties", "warehouses"];

export const SCOPES = {
  transactions: { label: "Transactions and stock only", tables: TRANSACTION_TABLES },
  all: { label: "Everything (also items, parties and godowns)", tables: [...TRANSACTION_TABLES, ...MASTER_TABLES] },
};
export const CONFIRM_PHRASE = "DELETE TEST DATA";

// Some tables come from optional migrations, so skip any that do not exist yet.
const existingTables = async (c, tables) => {
  const [rows] = await c.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema=DATABASE()");
  const have = new Set(rows.map((r) => String(r.t).toLowerCase()));
  return tables.filter((t) => have.has(t));
};

export async function previewCounts(scope) {
  const c = await pool.getConnection();
  try {
    const out = [];
    for (const t of await existingTables(c, SCOPES[scope].tables)) {
      const [[{ n }]] = await c.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      out.push({ table: t, count: Number(n) });
    }
    return out;
  } finally { c.release(); }
}

export async function resetData(scope) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const deleted = [];
    for (const t of await existingTables(c, SCOPES[scope].tables)) {
      const [res] = await c.query(`DELETE FROM \`${t}\``);
      deleted.push({ table: t, count: res.affectedRows });
    }
    await c.commit();
    return deleted;
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally { c.release(); }
}
