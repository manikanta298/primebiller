-- PrimeBiller — exact current warehouse master schema.
-- Prerequisite: organizations table must exist.

CREATE TABLE warehouses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  notes VARCHAR(150),
  allow_negative TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  default_uom VARCHAR(10) NOT NULL DEFAULT 'NOS',
  default_reorder DECIMAL(14,3) NOT NULL DEFAULT 0,
  max_stock DECIMAL(14,3) NULL,
  active_skus INT NOT NULL DEFAULT 0,
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);
