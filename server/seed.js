import { config } from './config.js';
import { db, tx } from './db.js';
import { hashPassword } from './auth.js';
import { CATEGORIES, PRODUCTS } from './catalog.js';

export async function seedCatalog() {
  if ((await db.one('SELECT COUNT(*) AS n FROM products')).n > 0) return false;
  await tx(async q => {
    for (const [i, c] of CATEGORIES.entries()) {
      await q.run('INSERT OR IGNORE INTO categories (slug, name, note, art, tone, sort) VALUES (?, ?, ?, ?, ?, ?)', c.slug, c.name, c.note, c.art, c.tone, i);
    }
    for (const [i, p] of PRODUCTS.entries()) {
      await q.run(`INSERT INTO products (id, slug, name, category, tag, short, description, made, usage, includes, art, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, p.slug, p.name, p.category, p.tag || null, p.short, p.desc, JSON.stringify(p.made), p.use,
        p.includes ? JSON.stringify(p.includes) : null, JSON.stringify(p.art), i);
      for (const [j, s] of p.sizes.entries()) {
        const { lastInsertRowid } = await q.run('INSERT INTO variants (product_id, label, sku, price, mrp, stock, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
          p.id, s.label, `${p.id}-${j + 1}`, s.price, s.mrp ?? null, s.stock, j);
        await q.run('INSERT INTO inventory_log (variant_id, delta, stock_after, reason) VALUES (?, ?, ?, ?)', lastInsertRowid, s.stock, s.stock, 'Opening stock');
      }
    }
  });
  return true;
}

// Creates the admin accounts listed in the environment, or promotes them if they already exist.
// An existing password is never overwritten.
export async function ensureAdmins() {
  for (const { email, password } of config.admins) {
    const user = await db.one('SELECT id, password_hash FROM users WHERE email = ?', email);
    if (!user) {
      const hash = password ? await hashPassword(password) : null;
      await db.run("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')", email, hash);
    } else {
      await db.run("UPDATE users SET role = 'admin' WHERE id = ?", user.id);
      if (!user.password_hash && password) await db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), user.id);
    }
  }
}
