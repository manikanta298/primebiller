import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import { connectionOptions, installFresh, migrate, listMigrations, splitStatements } from '../migrator.js';

// Everything runs in throwaway databases, never the shared test database.
const SNAPSHOT = {
  columns: `SELECT table_name t, column_name c, column_type ty, is_nullable n, column_default d, extra e, column_key k
            FROM information_schema.columns WHERE table_schema=DATABASE() ORDER BY t, c`,
  indexes: `SELECT table_name t, index_name i, non_unique u, seq_in_index s, column_name c
            FROM information_schema.statistics WHERE table_schema=DATABASE() ORDER BY t, i, s`,
  foreignKeys: `SELECT k.table_name t, k.column_name c, k.referenced_table_name rt, k.referenced_column_name rc, r.delete_rule dr, r.update_rule ur
                FROM information_schema.key_column_usage k
                JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.constraint_name=k.constraint_name AND r.table_name=k.table_name
                WHERE k.table_schema=DATABASE() AND k.referenced_table_name IS NOT NULL ORDER BY t, c, rt, rc`,
};
const snapshot = async (conn) => {
  const out = {};
  for (const [name, sql] of Object.entries(SNAPSHOT)) out[name] = (await conn.query(sql))[0].map((r) => Object.values(r).join(' | '));
  return out;
};
const diff = (a, b) => ({ onlyInUnified: a.filter((x) => !b.includes(x)), onlyViaMigrations: b.filter((x) => !a.includes(x)) });

test('unified schema and migrations', { skip: !process.env.DATABASE_URL }, async (t) => {
  const base = new URL(process.env.DATABASE_URL);
  const name = base.pathname.slice(1);
  const admin = await mysql.createConnection(connectionOptions());
  const dbs = [`${name}_schema_a_${process.pid}`, `${name}_schema_b_${process.pid}`];
  try { for (const db of dbs) await admin.query(`CREATE DATABASE \`${db}\``); }
  catch { await admin.end(); return t.skip('no permission to create scratch databases'); }
  t.after(async () => { for (const db of dbs) await admin.query(`DROP DATABASE IF EXISTS \`${db}\``); await admin.end(); });
  const open = (db) => { const u = new URL(base); u.pathname = `/${db}`; return mysql.createConnection(connectionOptions(u.toString(), { multipleStatements: true })); };
  const quiet = () => {};
  const a = await open(dbs[0]);
  const b = await open(dbs[1]);
  t.after(async () => { await a.end(); await b.end(); });

  await t.test('migration files are numbered without gaps and are small', () => {
    const list = listMigrations();
    assert.ok(list.length > 0);
    list.forEach((m, i) => {
      assert.equal(Number(m.version), i + 1, `${m.file} breaks the numbering`);
      assert.ok(m.sql.split('\n').length <= 80, `${m.file} is too long; split it into smaller migrations`);
      assert.ok(splitStatements(m.sql).length > 0, `${m.file} has no statements`);
    });
  });

  await t.test('fresh install from the unified schema marks every migration as included', async () => {
    await installFresh(a, quiet);
    const [rows] = await a.query('SELECT version, applied_how FROM schema_migrations ORDER BY version');
    assert.equal(rows.length, listMigrations().length);
    assert.ok(rows.every((r) => r.applied_how === 'BASELINE'));
    await assert.rejects(() => installFresh(a, quiet), /already has tables/);
    assert.deepEqual((await migrate(a, quiet)).applied, []);
  });

  await t.test('baseline schema + all migrations produces exactly the unified schema', async () => {
    await b.query(fs.readFileSync(new URL('./fixtures/baseline-core.sql', import.meta.url), 'utf8'));
    const result = await migrate(b, quiet);
    assert.equal(result.installed, false);
    assert.equal(result.applied.length, listMigrations().length);
    const [sa, sb] = [await snapshot(a), await snapshot(b)];
    for (const part of Object.keys(SNAPSHOT)) {
      const d = diff(sa[part], sb[part]);
      assert.deepEqual(d, { onlyInUnified: [], onlyViaMigrations: [] }, `${part} differ between unified-schema.sql and the migrations. Mirror every migration into sql/unified-schema.sql.`);
    }
  });

  await t.test('re-running is a no-op, and editing an applied migration is refused', async () => {
    assert.deepEqual((await migrate(b, quiet)).applied, []);
    await b.query("UPDATE schema_migrations SET checksum='tampered' WHERE version='0001'");
    await assert.rejects(() => migrate(b, quiet), /edited after it was applied/);
  });

  await t.test('an existing database from the old scripts upgrades safely', async () => {
    // Simulate a database that already has the changes (old migrate-*.js scripts) but no schema_migrations table.
    await b.query('DROP TABLE schema_migrations');
    const result = await migrate(b, quiet);
    assert.equal(result.installed, false);
    assert.equal(result.applied.length, listMigrations().length);
    assert.deepEqual(diff((await snapshot(a)).columns, (await snapshot(b)).columns), { onlyInUnified: [], onlyViaMigrations: [] });
  });
});
