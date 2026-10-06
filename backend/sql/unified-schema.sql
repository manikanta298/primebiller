-- PrimeBiller inventory & billing schema.
-- The target database is selected from DATABASE_URL by apply-schema.js.
-- Do not hard-code a database name here.

CREATE TABLE organizations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  gstin VARCHAR(15), state_code CHAR(2) NOT NULL DEFAULT '36',
  address VARCHAR(255),
  require_credit_override TINYINT(1) NOT NULL DEFAULT 1,
  require_batch_reason TINYINT(1) NOT NULL DEFAULT 1,
  eway_threshold DECIMAL(12,2) NOT NULL DEFAULT 50000.00
);

CREATE TABLE warehouses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL, name VARCHAR(100) NOT NULL, notes VARCHAR(150),
  allow_negative TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  default_uom VARCHAR(10) NOT NULL DEFAULT 'NOS',
  default_reorder DECIMAL(14,3) NOT NULL DEFAULT 0,
  max_stock DECIMAL(14,3) NULL,
  active_skus INT NOT NULL DEFAULT 0,
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

CREATE TABLE uoms (
  code VARCHAR(10) PRIMARY KEY, category ENUM('Weight','Count','Volume','Length') NOT NULL
);

CREATE TABLE items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL, sku VARCHAR(40) NOT NULL, name VARCHAR(150) NOT NULL,
  brand VARCHAR(60), category VARCHAR(60), hsn VARCHAR(8) NOT NULL,
  gst_rate DECIMAL(4,1) NOT NULL, base_uom VARCHAR(10) NOT NULL,
  batch_tracked TINYINT(1) NOT NULL DEFAULT 0, valuation ENUM('FIFO','WAVG') NOT NULL DEFAULT 'FIFO',
  UNIQUE KEY uq_item_sku (org_id, sku),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (base_uom) REFERENCES uoms(code)
);

CREATE TABLE item_uoms (
  item_id INT NOT NULL, uom VARCHAR(10) NOT NULL,
  formula VARCHAR(60) NOT NULL, to_base DECIMAL(14,6) NOT NULL,
  PRIMARY KEY (item_id, uom), FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE item_warehouse_settings (
  item_id INT NOT NULL, warehouse_id INT NOT NULL,
  reorder_point DECIMAL(14,3) NOT NULL DEFAULT 0, max_qty DECIMAL(14,3),
  PRIMARY KEY (item_id, warehouse_id),
  FOREIGN KEY (item_id) REFERENCES items(id), FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL, warehouse_id INT NOT NULL, batch_no VARCHAR(40) NOT NULL,
  mfg_date DATE, expiry_date DATE, unit_cost DECIMAL(14,2) NOT NULL,
  qty_on_hand DECIMAL(14,3) NOT NULL DEFAULT 0,
  qty_reserved DECIMAL(14,3) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_batch (item_id, warehouse_id, batch_no),
  CONSTRAINT chk_batch_qty CHECK (qty_on_hand >= 0 AND qty_reserved >= 0),
  FOREIGN KEY (item_id) REFERENCES items(id), FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE stock_ledger (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL, warehouse_id INT NOT NULL, item_id INT NOT NULL, batch_id INT,
  doc_no VARCHAR(30) NOT NULL,
  movement ENUM('PURCHASE','DC_ISSUE','TRANSFER_OUT','TRANSFER_IN','ADJ_UP','ADJ_DOWN') NOT NULL,
  qty DECIMAL(14,3) NOT NULL, value DECIMAL(14,2) NOT NULL, reason VARCHAR(255),
  posted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ledger_wh_time (warehouse_id, posted_at),
  FOREIGN KEY (item_id) REFERENCES items(id), FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE parties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL, name VARCHAR(150) NOT NULL, gstin VARCHAR(15), mobile VARCHAR(15),
  credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0, terms VARCHAR(30) DEFAULT 'Net 30',
  party_type ENUM('CUSTOMER','SUPPLIER') NOT NULL DEFAULT 'CUSTOMER',
  status ENUM('ACTIVE','ON_HOLD','CREDIT_WATCH') NOT NULL DEFAULT 'ACTIVE',
  preferred TINYINT(1) NOT NULL DEFAULT 0,
  FULLTEXT KEY ft_party_name (name), KEY ix_party_mobile (mobile)
);

CREATE TABLE doc_counters (
  org_id INT NOT NULL, doc_type VARCHAR(5) NOT NULL, fy VARCHAR(5) NOT NULL,
  last_no INT NOT NULL DEFAULT 0, PRIMARY KEY (org_id, doc_type, fy)   -- SELECT ... FOR UPDATE => gapless
);

CREATE TABLE sales_orders (
  id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, doc_no VARCHAR(30) NOT NULL UNIQUE,
  party_id INT NOT NULL, warehouse_id INT NOT NULL, order_date DATE NOT NULL,
  ship_to VARCHAR(200), terms VARCHAR(30),
  status ENUM('DRAFT','CONFIRMED','PARTIAL','DELIVERED','INVOICED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  taxable DECIMAL(14,2) NOT NULL DEFAULT 0, tax DECIMAL(14,2) NOT NULL DEFAULT 0,
  total DECIMAL(14,2) NOT NULL DEFAULT 0, autosaved_at DATETIME,
  FOREIGN KEY (party_id) REFERENCES parties(id)
);

CREATE TABLE sales_order_lines (
  id INT AUTO_INCREMENT PRIMARY KEY, so_id INT NOT NULL, line_no INT NOT NULL,
  item_id INT NOT NULL, warehouse_id INT NOT NULL, qty DECIMAL(14,3) NOT NULL, uom VARCHAR(10) NOT NULL,
  rate DECIMAL(14,2) NOT NULL, disc_pct DECIMAL(5,2) NOT NULL DEFAULT 0, gst_pct DECIMAL(4,1) NOT NULL,
  taxable DECIMAL(14,2) NOT NULL, amount DECIMAL(14,2) NOT NULL, qty_sent DECIMAL(14,3) NOT NULL DEFAULT 0,
  FOREIGN KEY (so_id) REFERENCES sales_orders(id) ON DELETE CASCADE, FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE challans (
  id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, doc_no VARCHAR(30) NOT NULL UNIQUE,
  so_id INT, party_id INT NOT NULL, warehouse_id INT NOT NULL, challan_date DATETIME NOT NULL,
  status ENUM('DRAFT','IN_TRANSIT','DELIVERED','INVOICED') NOT NULL DEFAULT 'DRAFT',
  vehicle_no VARCHAR(15), driver VARCHAR(80), driver_mobile VARCHAR(15), transporter VARCHAR(100),
  distance_km INT, taxable DECIMAL(14,2) NOT NULL DEFAULT 0, tax DECIMAL(14,2) NOT NULL DEFAULT 0,
  total DECIMAL(14,2) NOT NULL DEFAULT 0, pod_signed TINYINT(1) NOT NULL DEFAULT 0, invoice_id INT,
  FOREIGN KEY (party_id) REFERENCES parties(id)
);

CREATE TABLE challan_lines (
  id INT AUTO_INCREMENT PRIMARY KEY, challan_id INT NOT NULL, so_line_id INT,
  item_id INT NOT NULL, batch_id INT, qty DECIMAL(14,3) NOT NULL, rate DECIMAL(14,2) NOT NULL,
  override_reason VARCHAR(255),
  FOREIGN KEY (challan_id) REFERENCES challans(id) ON DELETE CASCADE
);

CREATE TABLE eway_bills (
  id INT AUTO_INCREMENT PRIMARY KEY, challan_id INT NOT NULL UNIQUE,   -- one per consignment
  ewb_no VARCHAR(12) NOT NULL, valid_until DATETIME NOT NULL, provider VARCHAR(30) DEFAULT 'CLEARTAX',
  idempotency_key VARCHAR(80) NOT NULL UNIQUE,
  vehicle_no VARCHAR(15), transporter_gstin VARCHAR(15), transporter_doc_no VARCHAR(30), gsp_log VARCHAR(500), status ENUM('ACTIVE','CANCELLED','EXPIRED') DEFAULT 'ACTIVE',
  FOREIGN KEY (challan_id) REFERENCES challans(id)
);

CREATE TABLE challan_events (
  id INT AUTO_INCREMENT PRIMARY KEY, challan_id INT NOT NULL, event VARCHAR(60) NOT NULL,
  note VARCHAR(150), at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY (challan_id),
  FOREIGN KEY (challan_id) REFERENCES challans(id) ON DELETE CASCADE
);

CREATE TABLE invoices (
  id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, doc_no VARCHAR(30) NOT NULL UNIQUE,
  party_id INT NOT NULL, warehouse_id INT, invoice_date DATE NOT NULL, due_date DATE,
  taxable DECIMAL(14,2) NOT NULL, cgst DECIMAL(14,2) NOT NULL, sgst DECIMAL(14,2) NOT NULL,
  igst DECIMAL(14,2) NOT NULL DEFAULT 0, total DECIMAL(14,2) NOT NULL,
  advance_adjusted DECIMAL(14,2) NOT NULL DEFAULT 0, balance_due DECIMAL(14,2) NOT NULL,
  FOREIGN KEY (party_id) REFERENCES parties(id)
);

CREATE TABLE receipts (
  id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, doc_no VARCHAR(30) NOT NULL UNIQUE,
  party_id INT NOT NULL, receipt_date DATE NOT NULL, mode ENUM('NEFT','Cheque','Cash','UPI') NOT NULL,
  amount DECIMAL(14,2) NOT NULL, unadjusted DECIMAL(14,2) NOT NULL,
  FOREIGN KEY (party_id) REFERENCES parties(id)
);

CREATE TABLE receipt_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY, receipt_id INT NOT NULL, invoice_id INT NOT NULL,
  amount DECIMAL(14,2) NOT NULL
);

CREATE TABLE stock_alerts (
  id INT AUTO_INCREMENT PRIMARY KEY, warehouse_id INT NOT NULL, item_id INT NOT NULL,
  kind ENUM('OUT_OF_STOCK','BELOW_REORDER','NEAR_EXPIRY','OVER_AGED') NOT NULL,
  severity ENUM('out','critical','low') NOT NULL, cover_days INT,
  acknowledged_at DATETIME NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY, org_id INT NOT NULL, filename VARCHAR(150),
  import_type ENUM('OPENING_STOCK','ITEMS','WAREHOUSES','PARTIES') NOT NULL DEFAULT 'OPENING_STOCK',
  status ENUM('UPLOADED','MAPPED','VALIDATED','COMMITTED','CANCELLED') NOT NULL DEFAULT 'UPLOADED',
  rows_total INT, rows_valid INT, rows_error INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_rows (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, job_id INT NOT NULL, row_no INT NOT NULL,
  payload JSON NOT NULL, error_kind VARCHAR(40), error_msg VARCHAR(200), fixed TINYINT(1) NOT NULL DEFAULT 0,
  KEY ix_job_err (job_id, error_kind)
);


-- Authentication schema previously applied by scripts/migrate-auth.js.
CREATE TABLE IF NOT EXISTS app_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  role ENUM('MASTER_ADMIN','USER') NOT NULL DEFAULT 'USER',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_app_sessions_user (user_id),
  INDEX ix_app_sessions_expiry (expires_at),
  CONSTRAINT fk_app_sessions_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_bootstrap (
  id TINYINT PRIMARY KEY,
  master_admin_user_id INT NULL,
  CONSTRAINT fk_bootstrap_master_admin FOREIGN KEY (master_admin_user_id) REFERENCES app_users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS auth_otps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  purpose VARCHAR(40) NOT NULL,
  otp_hash CHAR(64) NOT NULL,
  otp_code VARCHAR(6) NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,
  INDEX ix_auth_otp_lookup (email,purpose,created_at)
);

CREATE TABLE IF NOT EXISTS password_reset_otps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  otp_hash CHAR(64) NOT NULL,
  otp_code VARCHAR(6) NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,
  INDEX ix_reset_email_created (email, created_at),
  INDEX ix_reset_expiry (expires_at)
);

-- Pending dashboard schema previously applied by scripts/migrate-pending.js.
CREATE TABLE IF NOT EXISTS stock_transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  doc_no VARCHAR(30) NOT NULL UNIQUE,
  from_warehouse_id INT NOT NULL,
  to_warehouse_id INT NOT NULL,
  transfer_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('DRAFT','IN_TRANSIT','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  value DECIMAL(14,2) NOT NULL DEFAULT 0,
  pod_pending TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id INT NOT NULL,
  item_id INT NOT NULL,
  batch_id INT NULL,
  qty DECIMAL(14,3) NOT NULL,
  rate DECIMAL(14,2) NOT NULL,
  FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  doc_no VARCHAR(30) NOT NULL UNIQUE,
  warehouse_id INT NOT NULL,
  item_id INT NOT NULL,
  batch_id INT NOT NULL,
  adjustment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason VARCHAR(100) NOT NULL,
  qty DECIMAL(14,3) NOT NULL,
  value DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('PENDING','POSTED','REJECTED') NOT NULL DEFAULT 'PENDING',
  submitted_by VARCHAR(150),
  submitted_at DATETIME,
  approved_by VARCHAR(150),
  approved_at DATETIME,
  note VARCHAR(255),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (item_id) REFERENCES items(id),
  FOREIGN KEY (batch_id) REFERENCES batches(id)
);

INSERT IGNORE INTO auth_bootstrap (id,master_admin_user_id) VALUES (1,NULL);