import "dotenv/config";
import fs from "node:fs";
import mysql from "mysql2/promise";

const u = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: u.hostname, port: u.port || 3306, user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password), multipleStatements: true,
});
await conn.query(fs.readFileSync(new URL("../sql/schema.sql", import.meta.url), "utf8"));
console.log("Schema applied.");
await conn.end();
