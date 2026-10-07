# Database migrations

`../sql/unified-schema.sql` holds the **complete** schema. Files here are small, numbered upgrade
steps for databases that already exist. Both must always describe the same final schema.

## Add a schema change (new feature or bug fix)

1. `npm run migrate:new -- add_invoice_notes` creates the next file, e.g. `0007_add_invoice_notes.sql`.
2. Put **one small change** in it (a table, or a column), for example:
   ```sql
   -- Free-text note on invoices.
   ALTER TABLE invoices ADD COLUMN note VARCHAR(255) NULL;
   ```
   Statements end with `;` at the end of a line. Use `CREATE TABLE IF NOT EXISTS` for new tables and one
   `ADD COLUMN` per statement. "Already exists" errors (duplicate column, key, table) are skipped, so a
   migration is safe on a database that already has the change.
3. Make the **same change inside `sql/unified-schema.sql`** (add the column to its `CREATE TABLE`).
4. `npm test`. The schema test builds one database from the unified file and one from the baseline plus
   every migration, and fails with the exact difference if they do not match.
5. Deploy. `npm start` runs `npm run db:migrate`, which applies only the migrations not yet recorded in
   the `schema_migrations` table.

## Rules

- **Never edit a migration after it has been merged.** Its checksum is recorded, and the runner refuses to
  continue if it changes. Fix mistakes with a new migration.
- Keep migrations small (the test rejects files over 80 lines) and in order with no gaps.
- Migrations may include simple data fixes (`UPDATE`, `INSERT IGNORE`), but not seed or demo data.
- `test/fixtures/baseline-core.sql` is the core schema as it was before migrations started. Do not change it.

## Commands

| Command | What it does |
|---|---|
| `npm run db:schema` | Fresh install from the unified schema (empty database only) |
| `npm run db:migrate` | Fresh install if empty, otherwise apply pending migrations |
| `npm run migrate:new -- name` | Create the next numbered migration file |
