import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { sendOtpEmail } from "./email.js";

const databaseUrl = process.env.DATABASE_URL || "./data/primebiller.sqlite";
const databasePath = path.resolve(databaseUrl);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const betterAuthSecret =
  process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;

if (!betterAuthSecret || betterAuthSecret.length < 32) {
  throw new Error(
    "BETTER_AUTH_SECRET is missing or too short. Set a random secret with at least 32 characters in Render environment variables."
  );
}

const trustedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:5173",
];

const database = new Database(databasePath);

export const auth = betterAuth({
  appName: "Girder",
  database,
  baseURL: process.env.BETTER_AUTH_URL,
  secret: betterAuthSecret,
  trustedOrigins,

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 5,
      async sendVerificationOTP({ email, otp, type }) {
        await sendOtpEmail({ email, otp, type });
      },
    }),
  ],
});
