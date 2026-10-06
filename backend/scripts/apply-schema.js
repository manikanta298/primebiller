import "dotenv/config";
import fs from "node:fs";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing");
}

const u = new URL(databaseUrl);
const sslMode = (u.searchParams.get("ssl-mode") || "").toLowerCase();
u.searchParams.delete("ssl-mode");

const options = {
  host: u.hostname,
  port: Number(u.port || 3306),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: decodeURIComponent(u.pathname.replace(/^\//, "")),
  multipleStatements: true,
};

if (sslMode === "required" || sslMode === "verify-ca" || sslMode === "verify-full") {
  options.ssl = {
    rejectUnauthorized: sslMode !== "required",
  };
}

const conn = await mysql.createConnection(options);
await conn.query(fs.readFileSync(new URL("../sql/unified-schema.sql", import.meta.url), "utf8"));
console.log("Schema applied.");
await conn.end();
