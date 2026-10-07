-- Units of measure (required by Items and by the Warehouse "default_uom" check). Run first.
CREATE TABLE IF NOT EXISTS uoms (
  code VARCHAR(10) PRIMARY KEY,
  category ENUM('Weight','Count','Volume','Length') NOT NULL
);
INSERT IGNORE INTO uoms (code, category) VALUES
  ('BAG','Weight'),('KG','Weight'),('MT','Weight'),('TRUCK','Count'),
  ('SHEET','Count'),('CFT','Volume'),('NOS','Count');
