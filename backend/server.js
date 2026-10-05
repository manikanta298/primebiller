import "dotenv/config";
import express from "express";
import cors from "cors";
import { getSession, requireSession, signIn, signOut, requestPasswordReset, resetPassword } from "./auth.js";
import api from "./routes/api.js";
import { pool } from "./db.js";

const app = express();
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 3005);
const frontendOrigin = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "primebiller-api" });
});

// Unlike /api/health this actually queries MySQL, so it shows whether Render can reach Aiven.
app.get("/api/health/db", async (_req, res) => {
  const started = Date.now();
  try {
    await pool.query("SELECT 1");
    const [[{ n }]] = await pool.query("SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE()");
    res.json({ ok: true, db: "up", tables: n, ms: Date.now() - started });
  } catch (error) {
    console.error(`DB health check failed: code=${error.code || "unknown"} message=${error.message}`);
    res.status(503).json({ ok: false, db: "down", code: error.code || "unknown", ms: Date.now() - started });
  }
});

app.get("/api/auth/config", (_req, res) => {
  const demoEmail = String(process.env.DEMO_EMAIL || "").trim().toLowerCase();
  res.json({ demoEmail });
});

app.get("/api/auth/get-session", async (req, res) => {
  try {
    res.json((await getSession(req)) || null);
  } catch (error) {
    console.error("Session lookup failed:", error);
    res.status(500).json({ error: "Unable to load session" });
  }
});

app.post("/api/auth/sign-in/email", async (req, res) => {
  try {
    const result = await signIn(req, res, req.body || {});
    res.status(result.ok ? 200 : 401).json(result.ok ? result.session : { error: result.error });
  } catch (error) {
    console.error("Sign-in failed:", error);
    res.status(500).json({ error: "Unable to sign in" });
  }
});

app.post("/api/auth/sign-out", async (req, res) => {
  try {
    await signOut(req, res);
    res.json({ ok: true });
  } catch (error) {
    console.error("Sign-out failed:", error);
    res.status(500).json({ error: "Unable to sign out" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    await requestPasswordReset(req.body?.email);
    res.json({ ok: true });
  } catch (error) {
    console.error("Password reset request failed:", error);
    res.status(500).json({ error: "Unable to send the reset OTP" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const result = await resetPassword(req, res, req.body || {});
    res.status(result.ok ? 200 : 400).json(result.ok ? { ok: true, session: result.session } : { error: result.error });
  } catch (error) {
    console.error("Password reset failed:", error);
    res.status(500).json({ error: "Unable to reset password" });
  }
});

app.get("/api/me", requireSession, (req, res) => {
  res.json({ user: req.user });
});

app.use("/api", api);

// Last resort for any route error: log WHICH request failed and why, and answer with JSON
// (the default handler returns an HTML page that the frontend cannot read).
app.use((error, req, res, _next) => {
  console.error(`[api-error] ${req.method} ${req.originalUrl} -> code=${error.code || "none"} sql=${error.sqlMessage || "-"} message=${error.message}`);
  if (res.headersSent) return;
  res.status(error.status || 500).json({ error: error.sqlMessage ? "Database error" : error.message || "Internal server error", code: error.code });
});

process.on("unhandledRejection", (reason) => console.error("Unhandled promise rejection:", reason));

app.listen(port, "0.0.0.0", () => {
  console.log(`PrimeBiller API server running on port ${port}`);
  console.log(`Dummy login account: ${process.env.DEMO_EMAIL ? "configured" : "NOT CONFIGURED"}`);
});
