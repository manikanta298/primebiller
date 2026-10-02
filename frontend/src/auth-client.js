import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

const baseURL =
  import.meta.env.VITE_AUTH_URL || "https://primebiller.onrender.com";

export const authClient = createAuthClient({
  baseURL,
  plugins: [emailOTPClient()],
  fetchOptions: {
    credentials: "include",
  },
});
