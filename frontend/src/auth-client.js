import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

const baseURL = import.meta.env.VITE_AUTH_URL || "http://localhost:3005";

export const authClient = createAuthClient({
  baseURL,
  plugins: [emailOTPClient()],
  fetchOptions: {
    credentials: "include",
  },
});
