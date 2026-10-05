import "dotenv/config";
import { createUser } from "./auth.js";

const password = process.env.DUMMY_PASSWORD;
const demoEmail = String(process.env.DEMO_EMAIL || "").trim().toLowerCase();

if (!demoEmail) {
  throw new Error("Set DEMO_EMAIL before running npm run seed:demo.");
}
if (!password || password.length < 8) {
  throw new Error("Set DUMMY_PASSWORD (at least 8 characters) before running npm run seed:demo.");
}

const id = await createUser({
  name: "PrimeBiller Demo User",
  email: demoEmail,
  password,
});

console.log(`Dummy login user ready: ${demoEmail} (id ${id})`);
process.exit(0);
