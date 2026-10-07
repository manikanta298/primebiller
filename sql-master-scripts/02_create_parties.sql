-- PrimeBiller — exact current party master schema.
-- Prerequisite: organizations table must exist.

CREATE TABLE parties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  org_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  gstin VARCHAR(15),
  mobile VARCHAR(15),
  credit_limit DECIMAL(14,2) NOT NULL DEFAULT 0,
  terms VARCHAR(30) DEFAULT 'Net 30',
  party_type ENUM('CUSTOMER','SUPPLIER') NOT NULL DEFAULT 'CUSTOMER',
  status ENUM('ACTIVE','ON_HOLD','CREDIT_WATCH') NOT NULL DEFAULT 'ACTIVE',
  preferred TINYINT(1) NOT NULL DEFAULT 0,
  FULLTEXT KEY ft_party_name (name),
  KEY ix_party_mobile (mobile)
);
