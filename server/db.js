import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { config } from './config.js';

// Production: a hosted Turso database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
// Local development and tests: a plain SQLite file at DATABASE_PATH.
const remote = Boolean(config.turso.url);
if (!remote) fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const client = createClient(remote
  ? { url: config.turso.url, authToken: config.turso.authToken }
  : { url: 'file:' + config.dbPath });
export const usingTurso = remote;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    google_sub    TEXT UNIQUE,
    role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    last_address  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    art  TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT 'sand',
    sort INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS products (
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
  )`,
  `CREATE TABLE IF NOT EXISTS variants (
    id         INTEGER PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    sku        TEXT UNIQUE,
    price      INTEGER NOT NULL CHECK (price >= 0),
    mrp        INTEGER CHECK (mrp IS NULL OR mrp >= 0),
    stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    sort       INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
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
  )`,
  'CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id)',
  'CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at)',
  `CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    variant_id INTEGER NOT NULL,
    name       TEXT NOT NULL,
    size       TEXT NOT NULL,
    price      INTEGER NOT NULL,
    qty        INTEGER NOT NULL CHECK (qty > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_log (
    id          INTEGER PRIMARY KEY,
    variant_id  INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
    delta       INTEGER NOT NULL,
    stock_after INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    user_id     INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS subscribers (
    email      TEXT PRIMARY KEY COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    topic      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`
];

export async function migrate() {
  if (!remote) await client.execute('PRAGMA journal_mode = WAL');
  await client.batch(SCHEMA, 'write');
}

const toObjects = rs => rs.rows.map(r => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

// Small query helper over anything with an execute() — the client or an open transaction.
function queries(exec) {
  const run = async (sql, ...args) => exec({ sql, args: args.map(a => (a === undefined ? null : a)) });
  return {
    all: async (sql, ...args) => toObjects(await run(sql, ...args)),
    one: async (sql, ...args) => toObjects(await run(sql, ...args))[0],
    run: async (sql, ...args) => {
      const rs = await run(sql, ...args);
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid === undefined ? 0 : Number(rs.lastInsertRowid) };
    }
  };
}

export const db = queries(stmt => client.execute(stmt));

// Runs fn(q) inside a write transaction; any throw rolls everything back.
export async function tx(fn) {
  const t = await client.transaction('write');
  try {
    const result = await fn(queries(stmt => t.execute(stmt)));
    await t.commit();
    return result;
  } catch (err) {
    await t.rollback().catch(() => {});
    throw err;
  } finally {
    t.close();
  }
}
