import "dotenv/config";
import express from "express";
import cors from "cors";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import api from "./routes/api.js";

const app = express();
const port = Number(process.env.PORT || 3005);
const frontendOrigin = process.env.FRONTEND_URL || "https://frontend-phi-swart-46.vercel.app";

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Better Auth must receive the request before express.json().
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "girder-api" });
});

app.get("/api/me", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    res.json(session || null);
  } catch (error) {
    console.error("Session lookup failed:", error);
    res.status(500).json({ error: "Unable to load session" });
  }
});

app.use("/api", api); // session-protected Girder endpoints

app.listen(port, "0.0.0.0", () => {
  console.log(`Girder Better Auth server running on port ${port}`);
});
