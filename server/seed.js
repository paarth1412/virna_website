import { config } from './config.js';
import { one, run, tx } from './db.js';
import { hashPassword } from './auth.js';
import { CATEGORIES, PRODUCTS } from './catalog.js';

export function seedCatalog() {
  return tx(async () => {
    // Several function instances can start at once; only one of them seeds.
    await run('SELECT pg_advisory_xact_lock(4390)');
    if ((await one('SELECT COUNT(*)::int AS n FROM products')).n > 0) return false;
    for (const [i, c] of CATEGORIES.entries()) {
      await run('INSERT INTO categories (slug, name, note, art, tone, sort) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', c.slug, c.name, c.note, c.art, c.tone, i);
    }
    for (const [i, p] of PRODUCTS.entries()) {
      await run(`INSERT INTO products (id, slug, name, category, tag, short, description, made, usage, includes, art, sort)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, p.slug, p.name, p.category, p.tag || null, p.short, p.desc, JSON.stringify(p.made), p.use,
        p.includes ? JSON.stringify(p.includes) : null, JSON.stringify(p.art), i);
      for (const [j, s] of p.sizes.entries()) {
        const { id } = await one('INSERT INTO variants (product_id, label, sku, price, mrp, stock, sort) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
          p.id, s.label, `${p.id}-${j + 1}`, s.price, s.mrp ?? null, s.stock, j);
        await run('INSERT INTO inventory_log (variant_id, delta, stock_after, reason) VALUES (?, ?, ?, ?)', id, s.stock, s.stock, 'Opening stock');
      }
    }
    return true;
  });
}

// Creates the admin accounts listed in the environment, or promotes them if they already exist.
// An existing password is never overwritten.
export async function ensureAdmins() {
  for (const { email, password } of config.admins) {
    const user = await one('SELECT id, password_hash FROM users WHERE email = ?', email);
    if (!user) {
      const hash = password ? await hashPassword(password) : null;
      await run("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin') ON CONFLICT (email) DO NOTHING", email, hash);
    } else {
      await run("UPDATE users SET role = 'admin' WHERE id = ?", user.id);
      if (!user.password_hash && password) await run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), user.id);
    }
  }
}

// Seeds once per process (or function instance) before the first request is handled.
let ready;
export function ensureSeeded() {
  ready ??= (async () => {
    if (await seedCatalog()) console.log('Seeded the sample catalogue');
    await ensureAdmins();
  })().catch(err => { ready = undefined; throw err; });
  return ready;
}
