-- PrimeBiller reference data. Safe to run more than once (insert-only, never deletes).
-- Needed on a fresh database before Settings, bulk import or the entry forms work:
--   * uoms          -> unit dropdowns and the "Default UOM does not exist" import check
--   * organizations -> the Settings page (it shows "Loading settings..." without an org row)
-- Run after sql/unified-schema.sql (npm run db:schema).

INSERT IGNORE INTO uoms (code, category) VALUES
  ('BAG',   'Weight'),
  ('KG',    'Weight'),
  ('MT',    'Weight'),
  ('TRUCK', 'Count'),
  ('SHEET', 'Count'),
  ('CFT',   'Volume'),
  ('NOS',   'Count');

-- Creates one organization only if the table is empty. Edit the name, GSTIN and address in Settings.
INSERT INTO organizations (name, state_code)
SELECT 'My Company', '36' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM organizations);
