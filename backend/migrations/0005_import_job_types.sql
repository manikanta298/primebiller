-- Typed bulk imports (items, warehouses, parties) alongside opening stock.
ALTER TABLE import_jobs ADD COLUMN import_type ENUM('OPENING_STOCK','ITEMS','WAREHOUSES','PARTIES') NOT NULL DEFAULT 'OPENING_STOCK';
