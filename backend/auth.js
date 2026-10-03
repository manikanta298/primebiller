import crypto from "node:crypto";
import { promisify } from "node:util";
import { pool } from "./db.js";
import { sendOtpEmail } from "./email.js";

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "primebiller_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const TEMP_SESSION_TTL_SECONDS = 60 * 60 * 24;
const RESET_OTP_TTL_SECONDS = 60 * 5;
const MAX_RESET_ATTEMPTS = 5;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(String(password), salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt:16384:8:1:${salt}:${Buffer.from(derived).toString("hex")}`;
};

const verifyPassword = async (password, stored) => {
  const [scheme, n, r, p, salt, digest] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !digest) return false;
  const derived = await scrypt(String(password), salt, 64, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  const actual = Buffer.from(derived);
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const i = part.indexOf("=");
        return i === -1 ? [part, ""] : [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
      }),
  );

const cookieFlags = (req) => {
  const production = process.env.NODE_ENV === "production" || req.secure || req.headers["x-forwarded-proto"] === "https";
  return production
    ? "Path=/; HttpOnly; Secure; SameSite=None"
    : "Path=/; HttpOnly; SameSite=Lax";
};

const setSessionCookie = (req, res, token, maxAge) => {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(req)}; Max-Age=${maxAge}`);
};

const clearSessionCookie = (req, res) => {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; ${cookieFlags(req)}; Max-Age=0`);
};

export async function createUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || String(password || "").length < 8) {
    throw new Error("A valid email and password of at least 8 characters are required.");
  }
  const passwordHash = await hashPassword(password);
  const [existing] = await pool.query("SELECT id FROM app_users WHERE email=?", [normalizedEmail]);
  if (existing.length) {
    await pool.query(
      "UPDATE app_users SET name=?, password_hash=?, updated_at=NOW() WHERE id=?",
      [String(name || normalizedEmail).trim() || normalizedEmail, passwordHash, existing[0].id],
    );
    return existing[0].id;
  }
  const [result] = await pool.query(
    "INSERT INTO app_users (name,email,password_hash,email_verified,created_at,updated_at) VALUES (?,?,?,1,NOW(),NOW())",
    [String(name || normalizedEmail).trim() || normalizedEmail, normalizedEmail, passwordHash],
  );
  return result.insertId;
}

async function findUserByEmail(email) {
  const [rows] = await pool.query(
    "SELECT id,name,email,password_hash,email_verified FROM app_users WHERE email=? LIMIT 1",
    [normalizeEmail(email)],
  );
  return rows[0] || null;
}

async function createSession(userId, rememberMe = true) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const ttl = rememberMe ? SESSION_TTL_SECONDS : TEMP_SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);
  await pool.query(
    "INSERT INTO app_sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?, ?, ?, NOW(), NOW())",
    [tokenHash, userId, expiresAt],
  );
  return { token, ttl };
}

export async function signIn(req, res, { email, password, rememberMe = true }) {
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { ok: false, error: "Invalid email or password." };
  }
  const session = await createSession(user.id, rememberMe !== false);
  setSessionCookie(req, res, session.token, session.ttl);
  return {
    ok: true,
    session: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: Boolean(user.email_verified),
      },
    },
  };
}

export async function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const [rows] = await pool.query(
    `SELECT u.id,u.name,u.email,u.email_verified,s.expires_at
     FROM app_sessions s
     JOIN app_users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>NOW()
     LIMIT 1`,
    [hashToken(token)],
  );

  if (!rows[0]) return null;
  await pool.query("UPDATE app_sessions SET last_seen_at=NOW() WHERE token_hash=?", [hashToken(token)]);
  return {
    user: {
      id: rows[0].id,
      name: rows[0].name,
      email: rows[0].email,
      emailVerified: Boolean(rows[0].email_verified),
    },
  };
}

export async function signOut(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await pool.query("DELETE FROM app_sessions WHERE token_hash=?", [hashToken(token)]);
  }
  clearSessionCookie(req, res);
}

export async function requestPasswordReset(email) {
  const normalizedEmail = normalizeEmail(email);
  const user = await findUserByEmail(normalizedEmail);

  // Always return success to avoid exposing whether an account exists.
  if (!user) return { ok: true };

  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = hashToken(otp);

  await pool.query(
    "UPDATE password_reset_otps SET used_at=NOW() WHERE email=? AND used_at IS NULL",
    [normalizedEmail],
  );
  const expiresAt = new Date(Date.now() + RESET_OTP_TTL_SECONDS * 1000);
  const [inserted] = await pool.query(
    "INSERT INTO password_reset_otps (email,otp_hash,expires_at,attempts,created_at) VALUES (?, ?, ?, 0, NOW())",
    [normalizedEmail, otpHash, expiresAt],
  );

  try {
    await sendOtpEmail({
      email: normalizedEmail,
      otp,
      type: "forget-password",
    });
  } catch (error) {
    // The code never reached the user, so don't leave a live OTP behind.
    await pool.query("UPDATE password_reset_otps SET used_at=NOW() WHERE id=?", [inserted.insertId]);
    throw error;
  }

  return { ok: true };
}

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: Boolean(user.email_verified),
});

export async function resetPassword(req, res, { email, otp, password }) {
  const normalizedEmail = normalizeEmail(email);
  const otpValue = String(otp ?? "").trim();
  if (String(password || "").length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  if (!/^\d{6}$/.test(otpValue)) {
    return { ok: false, error: "Enter the 6-digit code from your email." };
  }

  const [rows] = await pool.query(
    "SELECT id,otp_hash,attempts,expires_at FROM password_reset_otps WHERE email=? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
    [normalizedEmail],
  );
  const record = rows[0];

  if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: "Invalid or expired OTP." };
  }

  if (Number(record.attempts) >= MAX_RESET_ATTEMPTS) {
    return { ok: false, error: "Too many invalid OTP attempts. Please request a new code." };
  }

  const validOtp = crypto.timingSafeEqual(
    Buffer.from(hashToken(otpValue), "hex"),
    Buffer.from(record.otp_hash, "hex"),
  );

  if (!validOtp) {
    await pool.query("UPDATE password_reset_otps SET attempts=attempts+1 WHERE id=?", [record.id]);
    return { ok: false, error: "Invalid or expired OTP." };
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) return { ok: false, error: "Invalid or expired OTP." };

  const passwordHash = await hashPassword(password);
  await pool.query("UPDATE app_users SET password_hash=?,updated_at=NOW() WHERE id=?", [passwordHash, user.id]);
  await pool.query("UPDATE password_reset_otps SET used_at=NOW() WHERE id=?", [record.id]);
  // Revoke every existing session (they may belong to whoever knew the old password),
  // then sign the user in with a fresh one so the app can go straight to the dashboard.
  await pool.query("DELETE FROM app_sessions WHERE user_id=?", [user.id]);
  const session = await createSession(user.id, true);
  setSessionCookie(req, res, session.token, session.ttl);

  return { ok: true, session: { user: publicUser(user) } };
}

export async function requireSession(req, res, next) {
  try {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: "Not signed in" });
    req.user = session.user;
    req.session = session;
    next();
  } catch (error) {
    console.error("Session lookup failed:", error);
    res.status(500).json({ error: "Unable to load session" });
  }
}

/* ------------------------------------------------------------------------------------------
 * DEV / TEST LOGIN BYPASS  -  REMOVE OR LEAVE DISABLED BEFORE GOING LIVE
 *
 * Lets you open the dashboard without email + password while testing.
 * It is OFF unless DEV_BYPASS_KEY is set (at least 24 characters). There is no default key in code.
 * When NODE_ENV=production it additionally requires ALLOW_DEV_BYPASS_IN_PRODUCTION=true.
 * It creates a normal session for a dedicated test user, so every other route behaves as usual.
 * ---------------------------------------------------------------------------------------- */
const DEV_USER_EMAIL = "dev-bypass@primebiller.local";
const DEV_USER_NAME = "Dev Tester";
const DEV_KEY_MIN_LENGTH = 24;
const DEV_MAX_ATTEMPTS = 5;
const DEV_WINDOW_MS = 15 * 60 * 1000;
const devAttempts = new Map(); // ip -> { count, resetAt }

export const isDevBypassEnabled = () => {
  const key = String(process.env.DEV_BYPASS_KEY || "");
  if (key.length < DEV_KEY_MIN_LENGTH) return false;
  if (process.env.NODE_ENV === "production") {
    return String(process.env.ALLOW_DEV_BYPASS_IN_PRODUCTION || "").toLowerCase() === "true";
  }
  return true;
};

export const logDevBypassStatus = () => {
  const key = String(process.env.DEV_BYPASS_KEY || "");
  if (isDevBypassEnabled()) {
    console.warn("WARNING: DEV LOGIN BYPASS IS ENABLED. Anyone with DEV_BYPASS_KEY can sign in. Disable it before going live.");
  } else if (key) {
    console.warn(
      key.length < DEV_KEY_MIN_LENGTH
        ? `DEV_BYPASS_KEY is set but shorter than ${DEV_KEY_MIN_LENGTH} characters; dev bypass stays disabled.`
        : "DEV_BYPASS_KEY is set but NODE_ENV=production without ALLOW_DEV_BYPASS_IN_PRODUCTION=true; dev bypass stays disabled.",
    );
  }
};

const devRateLimited = (ip) => {
  const now = Date.now();
  const entry = devAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    devAttempts.set(ip, { count: 1, resetAt: now + DEV_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > DEV_MAX_ATTEMPTS;
};

export async function devBypassSignIn(req, res, { key }) {
  if (!isDevBypassEnabled()) return { ok: false, status: 404, error: "Not found" };

  const ip = req.ip || "unknown";
  if (devRateLimited(ip)) {
    return { ok: false, status: 429, error: "Too many attempts. Try again in 15 minutes." };
  }

  // Compare digests so length differences don't leak and the comparison is constant-time.
  const given = crypto.createHash("sha256").update(String(key || "")).digest();
  const expected = crypto.createHash("sha256").update(String(process.env.DEV_BYPASS_KEY)).digest();
  if (!crypto.timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, error: "Invalid dev key." };
  }
  devAttempts.delete(ip);

  let user = await findUserByEmail(DEV_USER_EMAIL);
  if (!user) {
    // Random password: this account can only be entered through the bypass key.
    await createUser({ name: DEV_USER_NAME, email: DEV_USER_EMAIL, password: crypto.randomBytes(32).toString("hex") });
    user = await findUserByEmail(DEV_USER_EMAIL);
  }

  const session = await createSession(user.id, false);
  setSessionCookie(req, res, session.token, session.ttl);
  console.warn(`Dev bypass sign-in used from ${ip}`);
  return { ok: true, session: { user: publicUser(user) } };
}
