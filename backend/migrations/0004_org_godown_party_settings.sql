-- Organization policies, godown controls and party classification. One column per statement so a
-- partly applied database still finishes the rest.
ALTER TABLE organizations ADD COLUMN require_credit_override TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN require_batch_reason TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN eway_threshold DECIMAL(12,2) NOT NULL DEFAULT 50000.00;

ALTER TABLE warehouses ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE warehouses ADD COLUMN default_uom VARCHAR(10) NOT NULL DEFAULT 'NOS';
ALTER TABLE warehouses ADD COLUMN default_reorder DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE warehouses ADD COLUMN max_stock DECIMAL(14,3) NULL;
ALTER TABLE warehouses ADD COLUMN active_skus INT NOT NULL DEFAULT 0;

ALTER TABLE parties ADD COLUMN party_type ENUM('CUSTOMER','SUPPLIER') NOT NULL DEFAULT 'CUSTOMER';
ALTER TABLE parties ADD COLUMN status ENUM('ACTIVE','ON_HOLD','CREDIT_WATCH') NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE parties ADD COLUMN preferred TINYINT(1) NOT NULL DEFAULT 0;
