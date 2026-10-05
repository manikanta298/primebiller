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

## Stack
React + Vite (frontend) · Node.js + Express (API) · MySQL 8.0.16+ (database) · Better Auth (sessions).

## Quick start
```bash
cd backend && npm install && cp .env.example .env   # set DATABASE_URL + BETTER_AUTH_SECRET
npm run setup      # schema -> auth tables -> dummy logins -> demo data
npm run dev        # API on :3005
cd ../frontend && npm install && cp .env.example .env && npm run dev   # UI on :5173
```

## Authentication bootstrap

The application now uses a registration-first authentication flow.

- The first **successfully OTP-verified registration** becomes `MASTER_ADMIN`.
- That master-admin assignment is stored in `auth_bootstrap.master_admin_user_id` and protected by a database lock/foreign key so another concurrent registration cannot claim it.
- All later registrations receive the `USER` role.
- Normal email/password sign-in is available only after the registration OTP has been verified.
- Sessions use HTTP-only cookies with secure production flags.
- Passwords use Node.js `scrypt` hashing.
- Registration and password-reset OTPs are 6-digit cryptographically random values, stored only as SHA-256 hashes, expire automatically, and allow a maximum of five failed attempts.
- OTP delivery is currently **Render log-only**: the raw 6-digit code is printed to the API logs and no SMTP service is required. OTP generation/logging is synchronous only with database writes and does not throw a mail-delivery exception, so an SMTP outage cannot crash the authentication request.
- Registration OTP requests are throttled to one request per email per 60 seconds.

### Render configuration

No SMTP variables are required for the current authentication flow. Keep `DATABASE_URL`, `FRONTEND_URL`, and the normal Render/Vite deployment variables configured.

When a registration or password-reset OTP is requested, look in the Render service logs for a line like:

`[otp] registration OTP for user@example.com: 123456 (expires in 10 minutes, id=42)`

The raw OTP is intentionally **not persisted** in the database; only its SHA-256 hash is stored. This is safer than keeping plaintext OTPs in MySQL while still supporting the requested Render-log testing workflow.

## Build status
| Screen | Status |
|---|---|
| Login (unchanged) | done |
| Dashboard, Stock alerts, Find a document | done |
| Sales order (credit check, stock hold), Delivery challan (FIFO batches, override reason, e-way bill) | done |
| Convert challans to tax invoice (gapless numbering, advances), In-transit challan (`#/challans/transit`: e-way extend / Part-B / cancel, mark delivered) | done |
| Item batches (`#/items`), Bulk import (`#/import`: CSV upload, inline fixes, bulk fixes, 500-row commits), Print preview (`#/print`: 32-col thermal + A4 invoice, ESC/POS base64) | done |
