// Usage: npm run data:clear -- --scope=all|transactions --yes
// Without --yes it only prints what would be deleted.
import "dotenv/config";
import { SCOPES, previewCounts, resetData } from "../dataReset.js";
import { pool } from "../db.js";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const scope = arg("scope") || "transactions";
if (!SCOPES[scope]) { console.error(`Unknown scope "${scope}". Use transactions or all.`); process.exit(2); }

const counts = await previewCounts(scope);
console.log(`${SCOPES[scope].label}:`);
for (const { table, count } of counts) console.log(`  ${table.padEnd(26)} ${count}`);
if (!process.argv.includes("--yes")) {
  console.log("\nNothing deleted. Re-run with --yes to delete these rows.");
} else {
  const deleted = await resetData(scope);
  console.log(`\nDeleted ${deleted.reduce((n, d) => n + d.count, 0)} rows.`);
}
await pool.end();
