import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Uses a throwaway database so deleting everything cannot disturb other test files.
test('delete test data (API guard, scopes, CLI)', { skip: !process.env.DATABASE_URL }, async (t) => {
  const base = new URL(process.env.DATABASE_URL);
  const scratch = `${base.pathname.slice(1)}_reset_${process.pid}`;
  const admin = await mysql.createConnection(process.env.DATABASE_URL);
  try { await admin.query(`CREATE DATABASE \`${scratch}\``); } catch { await admin.end(); return t.skip('no permission to create a scratch database'); }
  t.after(async () => { await admin.query(`DROP DATABASE IF EXISTS \`${scratch}\``); await admin.end(); });

  const url = new URL(base); url.pathname = `/${scratch}`;
  const env = { ...process.env, DATABASE_URL: url.toString(), ORG_ID: '1' };
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8' });
  for (const script of ['db:schema', 'db:migrate', 'seed:data']) {
    const r = run('npm', ['run', script]);
    assert.equal(r.status, 0, `${script} failed: ${r.stderr || r.stdout}`);
  }

  await t.test('CLI dry run deletes nothing', () => {
    const r = run('npm', ['run', 'data:clear', '--', '--scope=all']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Nothing deleted/);
  });

  await t.test('API enforces role and confirmation, then deletes by scope', () => {
    const r = run('node', ['testing/reset-harness.mjs']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.split('RESULT ')[1]);
    assert.ok(out.before.items > 0 && out.before.invoices > 0 && out.before.ledger > 0, 'seed data present');
    assert.equal(out.userPreview, 403);
    assert.equal(out.userDelete, 403);
    assert.equal(out.preview.status, 200);
    assert.equal(out.preview.phrase, 'DELETE TEST DATA');
    assert.equal(out.preview.invoices, out.before.invoices);
    assert.equal(out.badScope, 422);
    assert.equal(out.noConfirm, 422);
    assert.deepEqual(out.afterRejected, out.before, 'rejected requests delete nothing');
    assert.equal(out.tx, 200);
    assert.equal(out.afterTx.invoices, 0);
    assert.equal(out.afterTx.ledger, 0);
    assert.equal(out.afterTx.items, out.before.items, 'transactions scope keeps masters');
    assert.equal(out.all, 200);
    assert.equal(out.afterAll.items, 0);
    assert.equal(out.afterAll.parties, 0);
    assert.equal(out.afterAll.warehouses, 0);
    assert.equal(out.afterAll.uoms, out.before.uoms, 'units are kept');
    assert.equal(out.afterAll.orgs, out.before.orgs, 'organization is kept');
  });
});
