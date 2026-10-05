-- Pending dashboard screens: transfers, adjustments, party classification, godown controls, org settings.
ALTER TABLE organizations
  ADD COLUMN require_credit_override TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN require_batch_reason TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN eway_threshold DECIMAL(12,2) NOT NULL DEFAULT 50000.00;

ALTER TABLE warehouses
  ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN default_uom VARCHAR(10) NOT NULL DEFAULT 'NOS',
  ADD COLUMN default_reorder DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN max_stock DECIMAL(14,3) NULL,
  ADD COLUMN active_skus INT NOT NULL DEFAULT 0;

ALTER TABLE parties
  ADD COLUMN party_type ENUM('CUSTOMER','SUPPLIER') NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN status ENUM('ACTIVE','ON_HOLD','CREDIT_WATCH') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN preferred TINYINT(1) NOT NULL DEFAULT 0;

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
