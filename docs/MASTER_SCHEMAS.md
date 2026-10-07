# Exact DB schemas (from `backend/sql/unified-schema.sql`, MySQL 8)
Run order: `sql/01_uoms.sql` → `02_warehouses.sql` → `03_parties.sql` → `04_items.sql`.
Existing DB with missing columns: run `sql/00_upgrade_existing_db.sql`.

## warehouses
| Column | Type | Null | Default | Excel column |
|---|---|---|---|---|
| id | INT AI PK | no | | – |
| org_id | INT FK→organizations | no | | – (set by app) |
| name | VARCHAR(100) | no | | **name** (required) |
| notes | VARCHAR(150) | yes | | notes |
| allow_negative | TINYINT(1) | no | 0 | allow_negative |
| active | TINYINT(1) | no | 1 | – |
| default_uom | VARCHAR(10) | no | 'NOS' | default_uom (must exist in `uoms`) |
| default_reorder | DECIMAL(14,3) | no | 0 | default_reorder |
| max_stock | DECIMAL(14,3) | yes | NULL | max_stock (≥ default_reorder) |
| active_skus | INT | no | 0 | – |

## parties
| Column | Type | Null | Default | Excel column |
|---|---|---|---|---|
| id | INT AI PK | no | | – |
| org_id | INT | no | | – |
| name | VARCHAR(150) | no | | **name** (required) |
| gstin | VARCHAR(15) | yes | | gstin (15-char GSTIN) |
| mobile | VARCHAR(15) | yes | | mobile (10–15 digits) |
| credit_limit | DECIMAL(14,2) | no | 0 | credit_limit |
| terms | VARCHAR(30) | yes | 'Net 30' | terms |
| party_type | ENUM(CUSTOMER,SUPPLIER) | no | CUSTOMER | party_type |
| status | ENUM(ACTIVE,ON_HOLD,CREDIT_WATCH) | no | ACTIVE | status |
| preferred | TINYINT(1) | no | 0 | preferred |

## items
| Column | Type | Null | Default | Excel column |
|---|---|---|---|---|
| id | INT AI PK | no | | – |
| org_id | INT FK→organizations | no | | – |
| sku | VARCHAR(40) UNIQUE(org_id,sku) | no | | **sku** |
| name | VARCHAR(150) | no | | **name** |
| brand | VARCHAR(60) | yes | | brand |
| category | VARCHAR(60) | yes | | category |
| hsn | VARCHAR(8) | no | | **hsn** (4/6/8 digits) |
| gst_rate | DECIMAL(4,1) | no | | **gst_rate** (0–100) |
| base_uom | VARCHAR(10) FK→uoms.code | no | | **base_uom** |
| batch_tracked | TINYINT(1) | no | 0 | batch_tracked |
| valuation | ENUM(FIFO,WAVG) | no | FIFO | valuation |

## uoms
`code VARCHAR(10) PK`, `category ENUM(Weight,Count,Volume,Length)`. Seeded: BAG, KG, MT, TRUCK, SHEET, CFT, NOS.
