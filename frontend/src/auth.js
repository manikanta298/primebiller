const baseURL = import.meta.env.VITE_AUTH_URL || "https://primebiller.onrender.com";

async function request(path, options = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || data?.message || response.statusText || "Request failed");
  }
  return data;
}

export const auth = {
  getConfig: () => request("/api/auth/config"),
  getSession: () => request("/api/auth/get-session"),
  signIn: ({ email, password, rememberMe = true }) =>
    request("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberMe }),
    }),
  requestRegistrationOtp: ({ name, email, password }) =>
    request("/api/auth/register/request-otp", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),
  register: ({ name, email, password, otp }) =>
    request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, otp }),
    }),
  signOut: () =>
    request("/api/auth/sign-out", {
      method: "POST",
    }),
  requestPasswordReset: (email) =>
    request("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: ({ email, otp, password }) =>
    request("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email, otp, password }),
    }),
};
