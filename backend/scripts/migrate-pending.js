import { pool } from "../db.js";

const alterAdd = async (table, column, definition) => {
  try {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (error.code !== "ER_DUP_FIELDNAME") throw error;
  }
};

await alterAdd("organizations","require_credit_override","TINYINT(1) NOT NULL DEFAULT 1");
await alterAdd("organizations","require_batch_reason","TINYINT(1) NOT NULL DEFAULT 1");
await alterAdd("organizations","eway_threshold","DECIMAL(12,2) NOT NULL DEFAULT 50000.00");

await alterAdd("warehouses","active","TINYINT(1) NOT NULL DEFAULT 1");
await alterAdd("warehouses","default_uom","VARCHAR(10) NOT NULL DEFAULT 'NOS'");
await alterAdd("warehouses","default_reorder","DECIMAL(14,3) NOT NULL DEFAULT 0");
await alterAdd("warehouses","max_stock","DECIMAL(14,3) NULL");
await alterAdd("warehouses","active_skus","INT NOT NULL DEFAULT 0");

await alterAdd("parties","party_type","ENUM('CUSTOMER','SUPPLIER') NOT NULL DEFAULT 'CUSTOMER'");
await alterAdd("parties","status","ENUM('ACTIVE','ON_HOLD','CREDIT_WATCH') NOT NULL DEFAULT 'ACTIVE'");
await alterAdd("parties","preferred","TINYINT(1) NOT NULL DEFAULT 0");

const statements = [
  `CREATE TABLE IF NOT EXISTS stock_transfers (
    id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, doc_no VARCHAR(30) NOT NULL UNIQUE,
    from_warehouse_id INT NOT NULL, to_warehouse_id INT NOT NULL,
    transfer_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('DRAFT','IN_TRANSIT','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    value DECIMAL(14,2) NOT NULL DEFAULT 0, pod_pending TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id)
  )`,
  `CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id INT AUTO_INCREMENT PRIMARY KEY, transfer_id INT NOT NULL, item_id INT NOT NULL, batch_id INT NULL,
    qty DECIMAL(14,3) NOT NULL, rate DECIMAL(14,2) NOT NULL,
    FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id)
  )`,
  `CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, doc_no VARCHAR(30) NOT NULL UNIQUE,
    warehouse_id INT NOT NULL, item_id INT NOT NULL, batch_id INT NOT NULL,
    adjustment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, reason VARCHAR(100) NOT NULL,
    qty DECIMAL(14,3) NOT NULL, value DECIMAL(14,2) NOT NULL DEFAULT 0,
    status ENUM('PENDING','POSTED','REJECTED') NOT NULL DEFAULT 'PENDING',
    submitted_by VARCHAR(150), submitted_at DATETIME, approved_by VARCHAR(150), approved_at DATETIME,
    note VARCHAR(255),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (item_id) REFERENCES items(id),
    FOREIGN KEY (batch_id) REFERENCES batches(id)
  )`,
];
for (const statement of statements) await pool.query(statement);

console.log("PrimeBiller pending-screen schema is up to date.");
await pool.end();
