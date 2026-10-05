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

## Dummy login

The deployed login flow is intentionally limited to the single account configured by `DEMO_EMAIL` and seeded from `DUMMY_PASSWORD`. Do not commit either value to Git.

Set these environment variables on Render:

- `DEMO_EMAIL` — the exact dummy email accepted by sign-in and password recovery.
- `DUMMY_PASSWORD` — the exact initial dummy password used by `npm run seed:demo`.
- `VITE_DEMO_EMAIL` — the same email for the frontend login form.

Run `npm run setup` after setting the backend variables so the dummy account exists in MySQL.

### Dummy-email OTP testing

For the configured `DEMO_EMAIL`, every password-reset OTP is:

1. printed immediately in the Render API logs as `[otp] ... OTP generated ...`;
2. stored in `password_reset_otps.otp_code` alongside its hashed value used for verification;
3. valid for 5 minutes and limited to 5 failed attempts.

The raw `otp_code` column is intentionally scoped to this testing/demo flow. Use a hash-only OTP store for a production authentication system.

If no mail provider is configured, the OTP is logged and the request can still be completed. On Render, Brevo or Resend can be used for HTTPS-based email delivery.

## Development-login status

The old developer-access/bypass login has been removed. There is no separate developer key or bypass endpoint in the login flow.

## Build status
| Screen | Status |
|---|---|
| Login (unchanged) | done |
| Dashboard, Stock alerts, Find a document | done |
| Sales order (credit check, stock hold), Delivery challan (FIFO batches, override reason, e-way bill) | done |
| Convert challans to tax invoice (gapless numbering, advances), In-transit challan (`#/challans/transit`: e-way extend / Part-B / cancel, mark delivered) | done |
| Item batches (`#/items`), Bulk import (`#/import`: CSV upload, inline fixes, bulk fixes, 500-row commits), Print preview (`#/print`: 32-col thermal + A4 invoice, ESC/POS base64) | done |
