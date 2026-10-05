import crypto from "node:crypto";
import { promisify } from "node:util";
import { pool } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "primebiller_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const TEMP_SESSION_TTL_SECONDS = 60 * 60 * 24;
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


const REGISTRATION_OTP_TTL_SECONDS = 10 * 60;
const OTP_RESEND_COOLDOWN_SECONDS = 60;

async function createOtp(email, purpose) {
  const normalizedEmail = normalizeEmail(email);
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = hashToken(otp);
  const expiresAt = new Date(Date.now() + REGISTRATION_OTP_TTL_SECONDS * 1000);

  await pool.query(
    "UPDATE auth_otps SET used_at=NOW() WHERE email=? AND purpose=? AND used_at IS NULL",
    [normalizedEmail, purpose],
  );
  const [result] = await pool.query(
    "INSERT INTO auth_otps (email,purpose,otp_hash,expires_at,attempts,created_at) VALUES (?,?,?,?,0,NOW())",
    [normalizedEmail, purpose, otpHash, expiresAt],
  );

  console.log(
    `[otp] ${purpose} OTP for ${normalizedEmail}: ${otp} (expires in 10 minutes, id=${result.insertId})`,
  );
  return { id: result.insertId, expiresInSeconds: REGISTRATION_OTP_TTL_SECONDS };
}

async function verifyOtp(email, purpose, otp) {
  const normalizedEmail = normalizeEmail(email);
  const otpValue = String(otp ?? "").trim();

  if (!/^\d{6}$/.test(otpValue)) {
    return { ok: false, error: "Enter the 6-digit OTP." };
  }

  const [rows] = await pool.query(
    "SELECT id,otp_hash,attempts,expires_at FROM auth_otps WHERE email=? AND purpose=? AND used_at IS NULL ORDER BY id DESC LIMIT 1",
    [normalizedEmail, purpose],
  );
  const record = rows[0];

  if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: "Invalid or expired OTP." };
  }

  if (Number(record.attempts) >= MAX_RESET_ATTEMPTS) {
    return { ok: false, error: "Too many invalid OTP attempts. Please request a new code." };
  }

  const actual = Buffer.from(hashToken(otpValue), "hex");
  const expected = Buffer.from(record.otp_hash, "hex");
  const valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);

  if (!valid) {
    await pool.query("UPDATE auth_otps SET attempts=attempts+1 WHERE id=?", [record.id]);
    return { ok: false, error: "Invalid or expired OTP." };
  }

  await pool.query("UPDATE auth_otps SET used_at=NOW() WHERE id=? AND used_at IS NULL", [record.id]);
  return { ok: true };
}

export async function requestRegistrationOtp({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = String(name || "").trim();
  const passwordValue = String(password || "");

  if (!normalizedName || normalizedName.length > 150) {
    return { ok: false, error: "Enter a valid name." };
  }
  if (!normalizedEmail || normalizedEmail.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (passwordValue.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    return { ok: false, error: "An account with this email already exists." };
  }

  const [[latest]] = await pool.query(
    "SELECT created_at FROM auth_otps WHERE email=? AND purpose='registration' ORDER BY id DESC LIMIT 1",
    [normalizedEmail],
  );
  if (latest && Date.now() - new Date(latest.created_at).getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
    return { ok: false, error: "Please wait 60 seconds before requesting another OTP." };
  }

  await createOtp(normalizedEmail, "registration");
  return { ok: true, message: "OTP generated. Check the Render API logs for the 6-digit code." };
}

export async function registerUser({ name, email, password, otp }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = String(name || "").trim();
  const passwordValue = String(password || "");

  if (!normalizedName || !normalizedEmail || passwordValue.length < 8) {
    return { ok: false, error: "Name, valid email, and password of at least 8 characters are required." };
  }

  const otpResult = await verifyOtp(normalizedEmail, "registration", otp);
  if (!otpResult.ok) return otpResult;

  const passwordHash = await hashPassword(passwordValue);
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      "INSERT IGNORE INTO auth_bootstrap (id,master_admin_user_id) VALUES (1,NULL)",
    );

    const [[bootstrap]] = await connection.query(
      "SELECT master_admin_user_id FROM auth_bootstrap WHERE id=1 FOR UPDATE",
    );

    const [[existing]] = await connection.query(
      "SELECT id FROM app_users WHERE email=? LIMIT 1",
      [normalizedEmail],
    );
    if (existing) {
      await connection.rollback();
      return { ok: false, error: "An account with this email already exists." };
    }

    const role = bootstrap.master_admin_user_id === null ? "MASTER_ADMIN" : "USER";
    const [inserted] = await connection.query(
      "INSERT INTO app_users (name,email,password_hash,email_verified,role,created_at,updated_at) VALUES (?,?,?,?,?,NOW(),NOW())",
      [normalizedName, normalizedEmail, passwordHash, 1, role],
    );

    if (role === "MASTER_ADMIN") {
      const [locked] = await connection.query(
        "UPDATE auth_bootstrap SET master_admin_user_id=? WHERE id=1 AND master_admin_user_id IS NULL",
        [inserted.insertId],
      );
      if (locked.affectedRows !== 1) {
        await connection.rollback();
        return { ok: false, error: "Master-admin bootstrap changed. Please retry registration." };
      }
    }

    await connection.commit();
    console.log(`[auth] Registered user ${normalizedEmail} as ${role} (id=${inserted.insertId}).`);
    return {
      ok: true,
      userId: inserted.insertId,
      role,
      message: role === "MASTER_ADMIN"
        ? "Registration complete. You are the master admin."
        : "Registration complete.",
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

async function findUserByEmail(email) {
  const [rows] = await pool.query(
    "SELECT id,name,email,password_hash,email_verified,role FROM app_users WHERE email=? LIMIT 1",
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
  const normalizedEmail = normalizeEmail(email);

  const user = await findUserByEmail(normalizedEmail);
  if (!user || !(await verifyPassword(password, user.password_hash)) || !user.email_verified) {
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
        role: user.role,
      },
    },
  };
}

export async function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const [rows] = await pool.query(
    `SELECT u.id,u.name,u.email,u.email_verified,u.role,s.expires_at
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
      role: rows[0].role,
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

  // Keep account existence private while still generating a real OTP for known users.
  if (!user) return { ok: true };

  await createOtp(normalizedEmail, "password_reset");
  return { ok: true };
}

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: Boolean(user.email_verified),
  role: user.role,
});

export async function resetPassword(req, res, { email, otp, password }) {
  const normalizedEmail = normalizeEmail(email);
  const otpResult = await verifyOtp(normalizedEmail, "password_reset", otp);
  if (!otpResult.ok) return otpResult;

  if (String(password || "").length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) return { ok: false, error: "Invalid or expired OTP." };

  const passwordHash = await hashPassword(password);
  await pool.query("UPDATE app_users SET password_hash=?,updated_at=NOW() WHERE id=?", [passwordHash, user.id]);
  await pool.query("DELETE FROM app_sessions WHERE user_id=?", [user.id]);

  const session = await createSession(user.id, true);
  setSessionCookie(req, res, session.token, session.ttl);
  return { ok: true, session: { user: publicUser({ ...user, password_hash: undefined }) } };
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
