-- PrimeBiller — exact current item master schema.
-- Prerequisites: organizations and uoms tables must exist.

CREATE TABLE items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  sku VARCHAR(40) NOT NULL,
  name VARCHAR(150) NOT NULL,
  brand VARCHAR(60),
  category VARCHAR(60),
  hsn VARCHAR(8) NOT NULL,
  gst_rate DECIMAL(4,1) NOT NULL,
  base_uom VARCHAR(10) NOT NULL,
  batch_tracked TINYINT(1) NOT NULL DEFAULT 0,
  valuation ENUM('FIFO','WAVG') NOT NULL DEFAULT 'FIFO',
  UNIQUE KEY uq_item_sku (org_id, sku),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (base_uom) REFERENCES uoms(code)
);
