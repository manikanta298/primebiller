-- For a database created BEFORE migration 0004: adds any missing columns (MySQL 8, safe to re-run).
-- A missing column is the usual cause of the warehouse "mismatch" / "Unknown column" error on upload.
DROP PROCEDURE IF EXISTS add_col;
DELIMITER $$
CREATE PROCEDURE add_col(t VARCHAR(64), c VARCHAR(64), ddl VARCHAR(255))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = t AND column_name = c) THEN
    SET @s = CONCAT('ALTER TABLE ', t, ' ADD COLUMN ', c, ' ', ddl);
    PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END$$
DELIMITER ;

CALL add_col('warehouses','active',          'TINYINT(1) NOT NULL DEFAULT 1');
CALL add_col('warehouses','default_uom',     "VARCHAR(10) NOT NULL DEFAULT 'NOS'");
CALL add_col('warehouses','default_reorder', 'DECIMAL(14,3) NOT NULL DEFAULT 0');
CALL add_col('warehouses','max_stock',       'DECIMAL(14,3) NULL');
CALL add_col('warehouses','active_skus',     'INT NOT NULL DEFAULT 0');
CALL add_col('parties','party_type', "ENUM('CUSTOMER','SUPPLIER') NOT NULL DEFAULT 'CUSTOMER'");
CALL add_col('parties','status',     "ENUM('ACTIVE','ON_HOLD','CREDIT_WATCH') NOT NULL DEFAULT 'ACTIVE'");
CALL add_col('parties','preferred',  'TINYINT(1) NOT NULL DEFAULT 0');
DROP PROCEDURE add_col;
