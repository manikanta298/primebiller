import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

const makePasswordHash = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt:16384:8:1:${salt}:${Buffer.from(derived).toString("hex")}`;
};

test("standard sign-in accepts a verified app_users account regardless of DEMO_EMAIL", { skip: !process.env.DATABASE_URL }, async (t) => {
  const { pool } = await import("../db.js");
  const { signIn } = await import("../auth.js");

  const email = `auth-test-${Date.now()}@example.test`;
  const password = "TestPassword123!";
  const passwordHash = await makePasswordHash(password);

  t.after(async () => {
    await pool.query("DELETE FROM app_users WHERE email=?", [email]);
    await pool.end();
  });

  const [created] = await pool.query(
    "INSERT INTO app_users (name,email,password_hash,email_verified,role) VALUES (?,?,?,?,?)",
    ["Authentication Test User", email, passwordHash, 1, "USER"],
  );

  const headers = {};
  const req = {
    secure: true,
    headers: { "x-forwarded-proto": "https" },
  };
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  const result = await signIn(req, res, { email, password, rememberMe: true });

  assert.equal(result.ok, true);
  assert.equal(result.session.user.id, created.insertId);
  assert.equal(result.session.user.email, email);
  assert.match(headers["Set-Cookie"], /^primebiller_session=/);

  const [[session]] = await pool.query(
    "SELECT user_id,expires_at FROM app_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
    [created.insertId],
  );
  assert.equal(session.user_id, created.insertId);
  assert.ok(new Date(session.expires_at).getTime() > Date.now());
});

test("standard sign-in rejects an unverified account", { skip: !process.env.DATABASE_URL }, async (t) => {
  const { pool } = await import("../db.js");
  const { signIn } = await import("../auth.js");

  const email = `auth-unverified-${Date.now()}@example.test`;
  const password = "TestPassword123!";
  const passwordHash = await makePasswordHash(password);

  t.after(async () => {
    await pool.query("DELETE FROM app_users WHERE email=?", [email]);
    await pool.end();
  });

  await pool.query(
    "INSERT INTO app_users (name,email,password_hash,email_verified,role) VALUES (?,?,?,?,?)",
    ["Unverified Test User", email, passwordHash, 0, "USER"],
  );

  const result = await signIn(
    { secure: true, headers: { "x-forwarded-proto": "https" } },
    { setHeader() {} },
    { email, password, rememberMe: true },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, "Invalid email or password.");
});
