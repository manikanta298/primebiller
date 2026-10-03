import "dotenv/config";
import { auth } from "./auth.js";

// Creates the dummy logins, or RESETS their password to DUMMY_PASSWORD if they already exist.
// Safe to re-run. Run it with the same DATABASE_URL that Render uses (the Aiven one).
const password = process.env.DUMMY_PASSWORD || "Girder@12345";
const users = [
  { name: "Harish K.", email: "owner@girder.test" },
  { name: "Manikanta Kambala", email: process.env.DEMO_EMAIL || "manikantakambala12@gmail.com" },
];

const ctx = await auth.$context;
for (const u of users) {
  const found = await ctx.internalAdapter.findUserByEmail(u.email.toLowerCase(), { includeAccounts: true });
  if (found) {
    await ctx.internalAdapter.updatePassword(found.user.id, await ctx.password.hash(password));
    console.log("Password reset for existing login:", u.email);
  } else {
    await auth.api.signUpEmail({ body: { ...u, password } });
    console.log("Dummy login created:", u.email);
  }
}
process.exit(0);
