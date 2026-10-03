import "dotenv/config";
import express from "express";
import cors from "cors";
import { getSession, requireSession, signIn, signOut, requestPasswordReset, resetPassword, createUser } from "./auth.js";
import api from "./routes/api.js";

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

app.post("/api/auth/sign-up/email", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const id = await createUser({ name, email, password });
    const result = await signIn(req, res, { email, password, rememberMe: true });
    res.status(201).json({ ...result.session, userId: id });
  } catch (error) {
    console.error("Sign-up failed:", error);
    res.status(400).json({ error: error.message || "Unable to create account" });
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

app.listen(port, "0.0.0.0", () => {
  console.log(`PrimeBiller API server running on port ${port}`);
});
