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

## Dummy logins (until a real email ID is provided)
`owner@girder.test` and `manikantakambala12@gmail.com`, both with `DUMMY_PASSWORD` from `backend/.env` (default `Girder@12345`).
With `SMTP_HOST` empty, password-reset OTPs print in the API console. For real email, set the Google SMTP values in `backend/.env` (see `.env.example`) using a Google App Password, then restart the API. Gmail allows ~500 emails/day.

## Build status
| Screen | Status |
|---|---|
| Login (unchanged) | done |
| Dashboard, Stock alerts, Find a document | done |
| Sales order (credit check, stock hold), Delivery challan (FIFO batches, override reason, e-way bill) | done |
| Convert challans to tax invoice (gapless numbering, advances), In-transit challan (`#/challans/transit`: e-way extend / Part-B / cancel, mark delivered) | done |
| Item batches (`#/items`), Bulk import (`#/import`: CSV upload, inline fixes, bulk fixes, 500-row commits), Print preview (`#/print`: 32-col thermal + A4 invoice, ESC/POS base64) | done |
