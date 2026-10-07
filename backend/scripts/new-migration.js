// `npm run migrate:new -- add_invoice_notes` creates the next numbered migration file.
import fs from "node:fs";
import { listMigrations } from "../migrator.js";

const name = (process.argv[2] || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
if (!name) { console.error("Usage: npm run migrate:new -- <short_description>"); process.exit(2); }
const next = String(Math.max(0, ...listMigrations().map((m) => Number(m.version))) + 1).padStart(4, "0");
const file = new URL(`../migrations/${next}_${name}.sql`, import.meta.url);
fs.writeFileSync(file, `-- ${name.replace(/_/g, " ")}
-- One small change per file. Statements end with ";" at the end of a line.
-- Also make the same change in sql/unified-schema.sql (npm test fails if they differ).

`);
console.log(`Created backend/migrations/${next}_${name}.sql`);
