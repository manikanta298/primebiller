# PrimeBiller Backend

Node.js + Express API with first-party MySQL authentication.

## Authentication

- Registration is verified with a 6-digit OTP.
- The first successfully verified registration becomes the permanent `MASTER_ADMIN`.
- Later registrations receive the `USER` role.
- Master-admin ownership is serialized with a MySQL row lock and protected from deletion by the bootstrap foreign key.
- Passwords use Node.js `scrypt`.
- Sessions use HTTP-only cookies and production `Secure; SameSite=None` flags.
- Password reset uses the same 6-digit OTP algorithm.

## OTP delivery

There is intentionally no SMTP dependency in the current deployment. Registration and password-reset OTPs are generated with `crypto.randomInt(100000, 1000000)` and printed directly to the Render API logs.

Example:

`[otp] registration OTP for user@example.com: 123456 (expires in 10 minutes, id=42)`

The plaintext OTP is never stored. Only its SHA-256 hash, expiry, purpose, and attempt counter are stored in `auth_otps`.

OTP generation/logging does not call an external mail provider, so SMTP/network failures cannot crash the authentication request.

## Local setup

Run:

```bash
npm install
npm run db:schema
npm run db:migrate
npm run seed:data
npm start
```

No `DEMO_EMAIL`, `DUMMY_PASSWORD`, `SMTP_*`, Brevo, or Resend variables are required for authentication.

After registration, the API creates the user's session automatically and the frontend routes to the dashboard.
