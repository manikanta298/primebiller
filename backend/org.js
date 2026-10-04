import { q } from "./db.js";

/*
 * The organisation id used by every route.
 * It used to be hard-coded as `const ORG = 1`, which breaks as soon as the database has been
 * re-seeded (seeds use DELETE, so AUTO_INCREMENT keeps counting and the org is no longer id 1).
 *
 * `ORG` is an exported *live binding*: importing modules always see the latest value.
 * Set ORG_ID in the environment to pin a specific organisation.
 */
export let ORG = Number(process.env.ORG_ID) || 1;

let checkedAt = 0;
export async function refreshOrg() {
  if (process.env.ORG_ID) return ORG;
  if (Date.now() - checkedAt < 30_000) return ORG;
  const [row] = await q("SELECT id FROM organizations ORDER BY id LIMIT 1");
  if (row) ORG = row.id;
  checkedAt = Date.now();
  return ORG;
}

export const orgMiddleware = async (_req, _res, next) => {
  try {
    await refreshOrg();
    next();
  } catch (error) {
    next(error);
  }
};
