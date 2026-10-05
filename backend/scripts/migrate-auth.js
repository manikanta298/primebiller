import { pool } from "../db.js";

const statements = [
  `CREATE TABLE IF NOT EXISTS app_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    role ENUM('MASTER_ADMIN','USER') NOT NULL DEFAULT 'USER',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_app_sessions_user (user_id),
    INDEX ix_app_sessions_expiry (expires_at),
    CONSTRAINT fk_app_sessions_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS auth_bootstrap (
    id TINYINT PRIMARY KEY,
    master_admin_user_id INT NULL,
    CONSTRAINT fk_bootstrap_master_admin FOREIGN KEY (master_admin_user_id) REFERENCES app_users(id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS auth_otps (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    purpose VARCHAR(40) NOT NULL,
    otp_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME NULL,
    INDEX ix_auth_otp_lookup (email,purpose,created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS password_reset_otps (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    otp_hash CHAR(64) NOT NULL,
    otp_code VARCHAR(6) NULL,
    expires_at DATETIME NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME NULL,
    INDEX ix_reset_email_created (email, created_at),
    INDEX ix_reset_expiry (expires_at)
  )`,
];

for (const sql of statements) await pool.query(sql);

try {
  await pool.query("ALTER TABLE password_reset_otps ADD COLUMN otp_code VARCHAR(6) NULL AFTER otp_hash");
} catch (error) {
  if (error.code !== "ER_DUP_FIELDNAME") throw error;
}

try {
  await pool.query("ALTER TABLE app_users ADD COLUMN role ENUM('MASTER_ADMIN','USER') NOT NULL DEFAULT 'USER' AFTER email_verified");
} catch (error) {
  if (error.code !== "ER_DUP_FIELDNAME") throw error;
}

console.log("PrimeBiller auth schema is up to date: app_users, app_sessions, password_reset_otps.");
await pool.end();
