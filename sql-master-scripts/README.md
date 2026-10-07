# PrimeBiller master SQL scripts

These files mirror the current master definitions used by the typed bulk importer.

Dependencies:
- warehouses → organizations
- parties → organizations
- items → organizations and uoms

The importer contract is intentionally separate from the full database schema. UI-only fields such as Warehouse Code should not be added to the database unless the application model changes.
