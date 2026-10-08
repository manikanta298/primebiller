import { q } from "../../db.js";
import { ORG } from "../../org.js";

// Indian financial year (1 Apr - 31 Mar) as "26-27".
export const fyLabel = (d = new Date()) => {
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
};
const fmt = (prefix, fy, n) => `${prefix}/${fy}/${String(n).padStart(5, "0")}`;

// Allocates the next number inside the caller's transaction. The upsert takes the counter row lock
// (and creates the first row of a new financial year), so numbers are gapless and concurrency-safe.
export async function nextDocNo(c, type, prefix, date = new Date()) {
  const fy = fyLabel(date);
  await c.query("INSERT INTO doc_counters (org_id,doc_type,fy,last_no) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE last_no=last_no+1", [ORG, type, fy]);
  const [[row]] = await c.query("SELECT last_no FROM doc_counters WHERE org_id=? AND doc_type=? AND fy=?", [ORG, type, fy]);
  return fmt(prefix, fy, row.last_no);
}

// Read-only preview of the number the next document will get (nothing is consumed).
export async function peekDocNo(type, prefix, date = new Date()) {
  const fy = fyLabel(date);
  const [row] = await q("SELECT last_no FROM doc_counters WHERE org_id=? AND doc_type=? AND fy=?", [ORG, type, fy]);
  return fmt(prefix, fy, (row?.last_no || 0) + 1);
}
