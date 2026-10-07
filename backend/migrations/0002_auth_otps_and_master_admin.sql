-- One-time codes (registration / password reset) and the master-admin marker.
CREATE TABLE IF NOT EXISTS auth_bootstrap (
  id TINYINT PRIMARY KEY,
  master_admin_user_id INT NULL,
  CONSTRAINT fk_bootstrap_master_admin FOREIGN KEY (master_admin_user_id) REFERENCES app_users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS auth_otps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  purpose VARCHAR(40) NOT NULL,
  otp_hash CHAR(64) NOT NULL,
  otp_code VARCHAR(6) NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,
  INDEX ix_auth_otp_lookup (email, purpose, created_at)
);

CREATE TABLE IF NOT EXISTS password_reset_otps (
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
);

-- Older databases created these tables without otp_code.
ALTER TABLE auth_otps ADD COLUMN otp_code VARCHAR(6) NULL AFTER otp_hash;
ALTER TABLE password_reset_otps ADD COLUMN otp_code VARCHAR(6) NULL AFTER otp_hash;

INSERT IGNORE INTO auth_bootstrap (id, master_admin_user_id) VALUES (1, NULL);

-- If accounts already exist but no master admin was recorded, the first account becomes master admin.
UPDATE auth_bootstrap SET master_admin_user_id = (SELECT id FROM app_users ORDER BY id LIMIT 1)
  WHERE id = 1 AND master_admin_user_id IS NULL;
UPDATE app_users SET role = 'MASTER_ADMIN'
  WHERE id = (SELECT master_admin_user_id FROM auth_bootstrap WHERE id = 1);
