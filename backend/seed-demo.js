import "dotenv/config";
import { auth } from "./auth.js";

const email = process.env.DEMO_EMAIL || "manikantakambala12@gmail.com";
const password = process.env.DEMO_PASSWORD;

if (!password) {
  throw new Error(
    "DEMO_PASSWORD is required. Put the demo password in backend/.env locally; never commit it."
  );
}

const result = await auth.api.signUpEmail({
  body: {
    name: "Manikanta Kambala",
    email,
    password,
  },
});

if (result?.user) {
  console.log("Demo account created: " + result.user.email);
} else {
  console.log("Demo account was not created. It may already exist.");
  console.log(result);
}
