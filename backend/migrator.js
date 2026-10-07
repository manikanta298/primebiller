import crypto from "node:crypto";
import fs from "node:fs";
import mysql from "mysql2/promise";

const SCHEMA_FILE = new URL("./sql/unified-schema.sql", import.meta.url);
const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

// Keep in sync with the same table in sql/unified-schema.sql (the schema drift test checks this).
const SCHEMA_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(10) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_how ENUM('MIGRATION','BASELINE') NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

// "Already there" errors: lets a migration run safely on a database that already has the change.
const ALREADY_PRESENT = new Set(["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_TABLE_EXISTS_ERROR", "ER_FK_DUP_NAME"]);

export function connectionOptions(databaseUrl = process.env.DATABASE_URL, extra = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is missing");
  const u = new URL(databaseUrl);
  const sslMode = (u.searchParams.get("ssl-mode") || "").toLowerCase();
  const options = {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    ...extra,
  };
  if (["required", "verify-ca", "verify-full"].includes(sslMode)) options.ssl = { rejectUnauthorized: sslMode !== "required" };
  return options;
}

export const connect = (databaseUrl) => mysql.createConnection(connectionOptions(databaseUrl, { multipleStatements: true }));

// Splits a migration file into statements (comment lines removed; statements end with ";" at a line end).
export const splitStatements = (sql) =>
  sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(/;[ \t]*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

export function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().map((file) => {
    const sql = fs.readFileSync(new URL(file, MIGRATIONS_DIR), "utf8");
    return { version: file.slice(0, 4), name: file.slice(5, -4), file, sql, checksum: crypto.createHash("sha256").update(sql).digest("hex") };
  });
}

const tableExists = async (conn, name) =>
  (await conn.query("SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=? LIMIT 1", [name]))[0].length > 0;

const record = (conn, m, how) =>
  conn.query("INSERT INTO schema_migrations (version,name,checksum,applied_how) VALUES (?,?,?,?)", [m.version, m.name, m.checksum, how]);

// Fresh database: create everything from the unified schema and mark every migration as already included.
export async function installFresh(conn, log = console.log) {
  if (await tableExists(conn, "organizations")) {
    throw new Error("This database already has tables. Use `npm run db:migrate` to upgrade it; the unified schema is for empty databases.");
  }
  await conn.query(fs.readFileSync(SCHEMA_FILE, "utf8"));
  await conn.query(SCHEMA_MIGRATIONS_DDL);
  const migrations = listMigrations();
  for (const m of migrations) await record(conn, m, "BASELINE");
  log(`Schema applied from unified-schema.sql (${migrations.length} migrations marked as included).`);
}

// Empty database -> installFresh. Existing database -> apply, in order, the migrations it has not seen.
export async function migrate(conn, log = console.log) {
  const [[lock]] = await conn.query("SELECT GET_LOCK('primebiller_migrate', 60) AS got");
  if (lock.got !== 1) throw new Error("Another migration is running; try again in a minute.");
  try {
    await conn.query(SCHEMA_MIGRATIONS_DDL);
    const [rows] = await conn.query("SELECT version,name,checksum FROM schema_migrations");
    const applied = new Map(rows.map((r) => [r.version, r]));

    if (applied.size === 0 && !(await tableExists(conn, "organizations"))) {
      await installFresh(conn, log);
      return { installed: true, applied: [] };
    }

    const done = [];
    for (const m of listMigrations()) {
      const prior = applied.get(m.version);
      if (prior) {
        if (prior.checksum !== m.checksum) throw new Error(`Migration ${m.file} was edited after it was applied. Never edit an applied migration; add a new one.`);
        continue;
      }
      for (const stmt of splitStatements(m.sql)) {
        try { await conn.query(stmt); }
        catch (e) {
          if (!ALREADY_PRESENT.has(e.code)) throw new Error(`Migration ${m.file} failed: ${e.message}\n${stmt.slice(0, 200)}`);
          log(`  ${m.file}: already present (${e.code}), skipped`);
        }
      }
      await record(conn, m, "MIGRATION");
      done.push(m.file);
      log(`Applied ${m.file}`);
    }
    if (!done.length) log("Database is up to date.");
    return { installed: false, applied: done };
  } finally {
    await conn.query("SELECT RELEASE_LOCK('primebiller_migrate')").catch(() => {});
  }
}
