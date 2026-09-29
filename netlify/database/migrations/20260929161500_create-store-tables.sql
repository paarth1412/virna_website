CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  google_sub    TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  last_address  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  art  TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'sand',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
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
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE variants (
  id         SERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  sku        TEXT UNIQUE,
  price      INTEGER NOT NULL CHECK (price >= 0),
  mrp        INTEGER CHECK (mrp IS NULL OR mrp >= 0),
  stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  sort       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id                  SERIAL PRIMARY KEY,
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
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_user ON orders(user_id);
CREATE INDEX orders_status ON orders(status, created_at);

CREATE TABLE order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  size       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX order_items_order ON order_items(order_id);

CREATE TABLE inventory_log (
  id          SERIAL PRIMARY KEY,
  variant_id  INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscribers (
  email      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  topic      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login/sign-up throttling, shared across all function instances.
CREATE TABLE rate_limits (
  key      TEXT PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at BIGINT NOT NULL
);
