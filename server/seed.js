import { config } from './config.js';
import { one, run, tx } from './db.js';
import { hashPassword } from './auth.js';
import { CATEGORIES, PRODUCTS } from './catalog.js';

export function seedCatalog() {
  if (one('SELECT COUNT(*) AS n FROM products').n > 0) return false;
  tx(() => {
    CATEGORIES.forEach((c, i) =>
      run('INSERT OR IGNORE INTO categories (slug, name, note, art, tone, sort) VALUES (?, ?, ?, ?, ?, ?)', c.slug, c.name, c.note, c.art, c.tone, i));
    PRODUCTS.forEach((p, i) => {
      run(`INSERT INTO products (id, slug, name, category, tag, short, description, made, usage, includes, art, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, p.slug, p.name, p.category, p.tag || null, p.short, p.desc, JSON.stringify(p.made), p.use,
        p.includes ? JSON.stringify(p.includes) : null, JSON.stringify(p.art), i);
      p.sizes.forEach((s, j) => {
        const { lastInsertRowid } = run('INSERT INTO variants (product_id, label, sku, price, mrp, stock, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
          p.id, s.label, `${p.id}-${j + 1}`, s.price, s.mrp ?? null, s.stock, j);
        run('INSERT INTO inventory_log (variant_id, delta, stock_after, reason) VALUES (?, ?, ?, ?)', Number(lastInsertRowid), s.stock, s.stock, 'Opening stock');
      });
    });
  });
  return true;
}

// Creates the admin accounts listed in .env, or promotes them if they already exist.
// An existing password is never overwritten.
export async function ensureAdmins() {
  for (const { email, password } of config.admins) {
    const user = one('SELECT id, password_hash FROM users WHERE email = ?', email);
    if (!user) {
      const hash = password ? await hashPassword(password) : null;
      run("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')", email, hash);
    } else {
      run("UPDATE users SET role = 'admin' WHERE id = ?", user.id);
      if (!user.password_hash && password) run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), user.id);
    }
  }
}
