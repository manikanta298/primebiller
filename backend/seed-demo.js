import "dotenv/config";
import { createUser } from "./auth.js";

const password = process.env.DUMMY_PASSWORD;
if (!password || password.length < 8) {
  throw new Error("Set DUMMY_PASSWORD (at least 8 characters) before running npm run seed:demo.");
}

const demoEmail = process.env.DEMO_EMAIL || "manikantakambala12@gmail.com";
const users = [
  { name: "Harish K.", email: "owner@girder.test" },
  { name: "Manikanta Kambala", email: demoEmail },
];

for (const user of users) {
  const id = await createUser({ ...user, password });
  console.log(`Demo user ready: ${user.email} (id ${id})`);
}

process.exit(0);
