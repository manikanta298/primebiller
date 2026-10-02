import "dotenv/config";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing (mysql://user:pass@host:3306/girder)");
}

const dbUrl = new URL(databaseUrl);
const sslMode = (dbUrl.searchParams.get("ssl-mode") || "").toLowerCase();
dbUrl.searchParams.delete("ssl-mode");

const poolOptions = {
  uri: dbUrl.toString(),
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  dateStrings: true,
};

if (sslMode === "required" || sslMode === "verify-ca" || sslMode === "verify-full") {
  poolOptions.ssl = {
    rejectUnauthorized: sslMode !== "required",
  };
}

export const pool = mysql.createPool(poolOptions);

export const q = async (sql, params = []) => (await pool.query(sql, params))[0];
