import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  last_address  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  art  TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'sand',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL REFERENCES categories(slug),
  tag         TEXT,
  short       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  made        TEXT NOT NULL DEFAULT '[]',
  usage       TEXT NOT NULL DEFAULT '',
  includes    TEXT,
  art         TEXT NOT NULL DEFAULT '{}',
  image_url   TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS variants (
  id         INTEGER PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  sku        TEXT UNIQUE,
  price      INTEGER NOT NULL CHECK (price >= 0),
  mrp        INTEGER CHECK (mrp IS NULL OR mrp >= 0),
  stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id                  INTEGER PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  status              TEXT NOT NULL CHECK (status IN ('pending_payment','placed','paid','shipped','delivered','cancelled')),
  pay_method          TEXT NOT NULL CHECK (pay_method IN ('online','cod')),
  subtotal            INTEGER NOT NULL,
  shipping            INTEGER NOT NULL,
  total               INTEGER NOT NULL,
  email               TEXT NOT NULL,
  phone               TEXT NOT NULL,
  address             TEXT NOT NULL,
  gift_message        TEXT NOT NULL DEFAULT '',
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT,
  stock_released      INTEGER NOT NULL DEFAULT 0,
  admin_note          TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  size       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0)
);

CREATE TABLE IF NOT EXISTS inventory_log (
  id          INTEGER PRIMARY KEY,
  variant_id  INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  email      TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  topic      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export const one = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

// Runs fn inside a write transaction; any throw rolls everything back.
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
