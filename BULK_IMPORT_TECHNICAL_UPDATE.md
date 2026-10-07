# PrimeBiller — Bulk Import Technical Update

## Status
Bulk-import visibility and legacy Excel header compatibility have been fixed on this branch.

## Findings
1. The UI requested `errorsOnly=1` after upload/refresh/edit, so valid rows were hidden from the preview.
2. The row API was hard-limited to 100 rows, so larger imports could appear incomplete.
3. The current database schema is already the source of truth; the main warehouse mismatch risk was legacy Excel header naming.

## Fixes
- Import rows API supports `limit` and `offset`, capped at the 5,000-row import limit.
- Error-only mode is now opt-in with `errorsOnly=1`.
- Bulk Import UI loads the full import set and displays loaded-row/error counts.
- Warehouse aliases: `Location` / `Address` → `notes`; `Capacity` / `Warehouse Capacity` / `Storage Capacity` → `max_stock`.
- Party aliases: `Contact` / `Contact Number` → `mobile`; `Type` → `party_type`.
- Integration coverage added for the aliases.

## Canonical import columns
### Warehouses
`name, notes, allow_negative, default_uom, default_reorder, max_stock`

### Parties
`name, party_type, gstin, mobile, credit_limit, terms, status, preferred`

### Items
`sku, name, hsn, gst_rate, base_uom, batch_tracked, valuation, brand, category`

## Schema notes
- Warehouse Code is not a current database column.
- Warehouse Location maps to the existing notes column.
- Warehouse Capacity maps to max_stock.
- Item rate is not an item-master column.
- Items require an existing UOM in the uoms table.

## Verification
The database-backed integration suite requires a configured DATABASE_URL and installed backend dependencies. Run `cd backend && npm ci && npm test` against a throwaway MySQL database before production deployment.
