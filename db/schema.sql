-- Fergburger Orders Ready App — Database Schema
-- Run once on fresh MySQL database

CREATE DATABASE IF NOT EXISTS fergburger CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fergburger;

-- Live orders (currently displayed on screens)
CREATE TABLE IF NOT EXISTS orders (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(10)  NOT NULL,
  ready_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_number (order_number)
);

-- Full audit log for reporting
CREATE TABLE IF NOT EXISTS orders_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_number  VARCHAR(10)  NOT NULL,
  ready_at      DATETIME     NOT NULL,
  collected_at  DATETIME     DEFAULT NULL,
  INDEX idx_date (ready_at),
  INDEX idx_order (order_number)
);

-- Staff users (for backend tablet auth)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Default admin user: username=admin, password=fergburger (change on first login!)
-- Password hash for "fergburger": bcrypt rounds=10
INSERT IGNORE INTO users (username, password_hash)
VALUES ('admin', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');
