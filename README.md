# PrimeBiller

Girder-style billing platform workspace.

## Project structure

```
primebiller/
├── frontend/                 # React + Vite login/UI application
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── vite.config.js
│
├── backend/                  # Better Auth + Express authentication server
│   ├── auth.js
│   ├── email.js
│   ├── server.js
│   ├── seed-demo.js
│   └── package.json
│
└── README.md
```

## Authentication

The login UI is now connected to **Better Auth** through a separate Express authentication server.

Implemented:
- Email + password sign-in.
- Persistent Better Auth sessions.
- SQLite storage for users, accounts, sessions, and verification records.
- Password-reset OTP flow using Better Auth's Email OTP plugin.
- 6-digit OTP with a 5-minute lifetime and up to 5 verification attempts.
- Demo account seed configuration for `manikantakambala12@gmail.com`.
- SMTP email delivery for the password-reset OTP.
- Password reset revokes other sessions.

Better Auth requires a server-side secret, a database, and a real email provider for OTP delivery. The demo password is intentionally **not committed to Git**; set it locally through `backend/.env`.

## Run the backend

```bash
cd backend
npm install
cp .env.example .env
```

Generate a strong Better Auth secret and put it in `BETTER_AUTH_SECRET`. For example:

```bash
openssl rand -base64 32
```

Then configure the demo password and SMTP credentials in `backend/.env`.

Run the Better Auth database migration:

```npm
npm run db:migrate
```

Seed the demo account:

```npm
npm run seed:demo
```

Start the authentication server:

```npm
npm run dev
```

The auth server runs at:

`http://localhost:3005`

Health check:

`http://localhost:3005/api/health`

## Run the frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

The Vite app normally runs at:

`http://localhost:5173`

The frontend calls Better Auth at `VITE_AUTH_URL`.

## Password reset flow

1. Click **Forgot password?** on the login page.
2. The demo email `manikantakambala12@gmail.com` is prefilled.
3. Click **Send OTP**.
4. Better Auth generates a one-time password and sends it through the configured SMTP provider.
5. Enter the 6-digit OTP.
6. Enter a new password with at least 8 characters.
7. Better Auth verifies the OTP and changes the password.

The Email OTP plugin officially supports the `forget-password` flow through `requestPasswordReset()` and `resetPassword()`. citeturn4search0

## Email delivery requirement

The application code is configured to send the OTP, but an actual SMTP account is required before an email can leave the server. Better Auth delegates email delivery to the application's configured email provider. citeturn3search10turn4search3

Do **not** put the demo password, SMTP password, or Better Auth secret into Git.

## Frontend build

```bash
cd frontend
npm run build
```
