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
├── backend/                  # Express + MySQL authentication/API server
│   ├── auth.js
│   ├── server.js
│   ├── scripts/
│   └── package.json
│
└── README.md
```

## Stack
React + Vite (frontend) · Node.js + Express (API) · MySQL 8.0.16+ (database) · first-party scrypt authentication + HTTP-only sessions.

## Quick start
```bash
cd backend && npm install && cp .env.example .env   # set DATABASE_URL + FRONTEND_URL
npm run setup      # schema -> auth tables -> demo data
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

## Master data: forms, bulk import, SQL scripts and cleanup

**Add one record.** Items, Parties and Godowns each have a *New …* button that opens a validated form (same rules as the bulk importer).

**Bulk import** (Bulk import page, or `POST /api/imports?type=ITEMS|WAREHOUSES|PARTIES`):

| Source | How |
|---|---|
| Excel | Upload a `.xlsx` (uses the `Data` sheet, or the first sheet). Save older `.xls` files as `.xlsx` first. |
| CSV | Upload a `.csv` (Excel's "CSV UTF-8" is fine). |
| JSON | Upload a `.json` file: an array of objects, or `{ "rows": [ … ] }`. Keys are the column names. |
| Google Sheets | Paste the sheet link on the import page. Share the sheet as **Anyone with the link can view**. A link containing `#gid=…` imports that tab; otherwise the first tab is used. Or download the sheet as `.xlsx` / `.csv` and upload it. |

Templates (Excel with dropdowns and an Instructions sheet, CSV, JSON, blank or with sample rows) are in [`/templates`](templates) and are also served from the import page. Regenerate them with `npm run templates:build` in `backend/`. Limits: 5,000 rows and 20 MB per upload. Rows are validated first; fix errors inline, then commit.

**MySQL scripts** (`backend/sql/`, run in this order on a new database after `npm run db:schema`):

1. `reference-data.sql` – units of measure and one organization row. Without these, Settings stays on "Loading settings…" and imports fail with "Default UOM does not exist". Safe to re-run.
2. `sample-masters.sql` – optional dummy godowns, parties and items (prefixed `Demo`). Safe to re-run.
3. `clear-test-data.sql` – deletes test data (same as the options below).

**Delete test data.** Settings → *Data & backup* → *Delete test data* (master admin only; shows row counts, requires typing `DELETE TEST DATA`). From a shell: `npm run data:clear -- --scope=transactions|all` previews, add `--yes` to delete. `transactions` clears documents and stock; `all` also clears items, parties and godowns. The organization, units and user accounts are always kept. This deletes across the whole database, so do not use it on data you want to keep.

## Database schema and migrations

The whole schema lives in one file, [`backend/sql/unified-schema.sql`](backend/sql/unified-schema.sql). Changes after that baseline are small numbered files in [`backend/migrations/`](backend/migrations). A new database gets the unified file; an existing one gets only the migrations it has not applied (tracked in `schema_migrations`). `npm start` does this automatically on every deploy. When you change the schema, add a migration **and** mirror it in the unified file; `npm test` fails if they differ. Step by step: [`backend/migrations/README.md`](backend/migrations/README.md).
