import { Router } from "express";
import { SCOPES, CONFIRM_PHRASE, previewCounts, resetData } from "../dataReset.js";

const r = Router();
const masterAdminOnly = (req, res, next) =>
  req.user?.role === "MASTER_ADMIN" ? next() : res.status(403).json({ error: "Only the master admin can delete data" });

r.get("/admin/data-reset/preview", masterAdminOnly, async (_req, res) => {
  const out = {};
  for (const scope of Object.keys(SCOPES)) out[scope] = { label: SCOPES[scope].label, tables: await previewCounts(scope) };
  res.json({ confirmPhrase: CONFIRM_PHRASE, scopes: out });
});

r.post("/admin/data-reset", masterAdminOnly, async (req, res) => {
  const { scope, confirm } = req.body || {};
  if (!SCOPES[scope]) return res.status(422).json({ error: "Choose what to delete: transactions or all" });
  if (confirm !== CONFIRM_PHRASE) return res.status(422).json({ error: `Type ${CONFIRM_PHRASE} to confirm` });
  const deleted = await resetData(scope);
  console.log(`[admin] data reset (${scope}) by ${req.user.email}: ${deleted.reduce((n, d) => n + d.count, 0)} rows`);
  res.json({ ok: true, scope, deleted });
});

export default r;
