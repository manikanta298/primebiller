// Regenerates the downloadable templates in /templates (Excel, CSV, JSON; blank and with sample rows).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TYPES } from "../routes/imports.js";
import { buildTemplate, SAMPLE_ROWS } from "../importFormats.js";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");
await fs.mkdir(out, { recursive: true });
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
for (const [type, meta] of Object.entries(TYPES)) {
  const slug = type.toLowerCase();
  await fs.writeFile(path.join(out, `${slug}-template.xlsx`), await buildTemplate(type, meta.columns, meta.required));
  await fs.writeFile(path.join(out, `${slug}-sample.xlsx`), await buildTemplate(type, meta.columns, meta.required, { sample: true }));
  await fs.writeFile(path.join(out, `${slug}-template.csv`), meta.columns.join(",") + "\n");
  await fs.writeFile(path.join(out, `${slug}-sample.csv`), meta.columns.join(",") + "\n" + SAMPLE_ROWS[type].map((r) => meta.columns.map((c) => q(r[c] ?? "")).join(",")).join("\n") + "\n");
  await fs.writeFile(path.join(out, `${slug}-sample.json`), JSON.stringify(SAMPLE_ROWS[type], null, 2) + "\n");
}
console.log(`Templates written to ${out}`);
process.exit(0);
