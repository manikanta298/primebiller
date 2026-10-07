// Helper for test/data-reset.integration.test.js. It is deliberately NOT under test/ so the test runner
// never executes it directly. It deletes data, so it refuses to run unless the database is a scratch one.
if (!/_reset_\d+$/.test(new URL(process.env.DATABASE_URL || 'mysql://x/none').pathname)) {
  console.error('reset-harness only runs against a scratch database named *_reset_<pid>');
  process.exit(3);
}
import express from 'express';
import request from 'supertest';
import { pool } from '../db.js';
import admin from '../routes/admin.js';

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { email: 'test@example.com', role: req.get('x-role') || 'USER' }; next(); });
app.use(admin);

const count = async (t) => Number((await pool.query(`SELECT COUNT(*) n FROM ${t}`))[0][0].n);
const snap = async () => ({ items: await count('items'), parties: await count('parties'), warehouses: await count('warehouses'), ledger: await count('stock_ledger'), invoices: await count('invoices'), uoms: await count('uoms'), orgs: await count('organizations') });
const as = (role) => ({ get: (u) => request(app).get(u).set('x-role', role), post: (u, b) => request(app).post(u).set('x-role', role).send(b) });

const out = { before: await snap() };
out.userPreview = (await as('USER').get('/admin/data-reset/preview')).status;
out.userDelete = (await as('USER').post('/admin/data-reset', { scope: 'all', confirm: 'DELETE TEST DATA' })).status;
const prev = await as('MASTER_ADMIN').get('/admin/data-reset/preview');
out.preview = { status: prev.status, phrase: prev.body.confirmPhrase, invoices: prev.body.scopes.transactions.tables.find((t) => t.table === 'invoices')?.count };
out.badScope = (await as('MASTER_ADMIN').post('/admin/data-reset', { scope: 'nope', confirm: 'DELETE TEST DATA' })).status;
out.noConfirm = (await as('MASTER_ADMIN').post('/admin/data-reset', { scope: 'all', confirm: 'yes' })).status;
out.afterRejected = await snap();
out.tx = (await as('MASTER_ADMIN').post('/admin/data-reset', { scope: 'transactions', confirm: 'DELETE TEST DATA' })).status;
out.afterTx = await snap();
out.all = (await as('MASTER_ADMIN').post('/admin/data-reset', { scope: 'all', confirm: 'DELETE TEST DATA' })).status;
out.afterAll = await snap();
console.log('RESULT ' + JSON.stringify(out));
await pool.end();
