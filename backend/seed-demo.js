import "dotenv/config";
import { auth } from "./auth.js";

const password = process.env.DUMMY_PASSWORD || "Girder@12345";
const users = [
  { name: "Harish K.", email: "owner@girder.test" },
  { name: "Manikanta Kambala", email: process.env.DEMO_EMAIL || "manikantakambala12@gmail.com" },
];

for (const u of users) {
  try {
    await auth.api.signUpEmail({ body: { ...u, password } });
    console.log("Dummy login created:", u.email);
  } catch (e) {
    console.log("Skipped", u.email, "-", e?.body?.message || e.message);
  }
}
process.exit(0);
