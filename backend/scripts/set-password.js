// Creates or repairs a login: stores a properly hashed password and marks the email verified.
// Use it when a user row was inserted by hand (phpMyAdmin/SQL) and sign-in rejects it.
//   NEW_PASSWORD='...' node scripts/set-password.js user@example.com ["Full name"]
// (the password is read from the environment so it stays out of shell history and process lists)
import "dotenv/config";
import { pool } from "../db.js";
import { hashPassword } from "../auth.js";

const email = String(process.argv[2] || "").trim().toLowerCase();
const name = process.argv[3] || email.split("@")[0];
const password = String(process.env.NEW_PASSWORD || "");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
  console.error("Usage: NEW_PASSWORD='at-least-8-chars' node scripts/set-password.js user@example.com [name]");
  process.exit(1);
}
const hash = await hashPassword(password);
const [[user]] = await pool.query("SELECT id FROM app_users WHERE email=?", [email]);
if (user) {
  await pool.query("UPDATE app_users SET password_hash=?,email_verified=1,updated_at=NOW() WHERE id=?", [hash, user.id]);
  await pool.query("DELETE FROM app_sessions WHERE user_id=?", [user.id]);
  console.log(`Password updated for ${email} (id=${user.id}); existing sessions signed out.`);
} else {
  const [[boot]] = await pool.query("SELECT master_admin_user_id FROM auth_bootstrap WHERE id=1");
  const role = boot?.master_admin_user_id == null ? "MASTER_ADMIN" : "USER";
  const [ins] = await pool.query("INSERT INTO app_users (name,email,password_hash,email_verified,role) VALUES (?,?,?,1,?)", [name, email, hash, role]);
  if (role === "MASTER_ADMIN") await pool.query("INSERT INTO auth_bootstrap (id,master_admin_user_id) VALUES (1,?) ON DUPLICATE KEY UPDATE master_admin_user_id=IFNULL(master_admin_user_id,VALUES(master_admin_user_id))", [ins.insertId]);
  console.log(`Account created for ${email} (id=${ins.insertId}, role=${role}).`);
}
await pool.end();
