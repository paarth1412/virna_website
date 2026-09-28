import { Router } from 'express';
import { all, one, run, tx } from '../db.js';
import { HttpError, requireAdmin } from '../auth.js';
import { cancelOrder, getOrderByNumber, listProducts, logStock, serializeOrder } from '../store.js';
import * as v from '../validate.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const LOW_STOCK = 5;
const SOLD = "('placed','paid','shipped','delivered')";

adminRouter.get('/summary', (_req, res) => {
  const today = one(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders
                     WHERE status IN ${SOLD} AND date(created_at, '+330 minutes') = date('now', '+330 minutes')`);
  const month = one(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue FROM orders
                     WHERE status IN ${SOLD} AND strftime('%Y-%m', created_at, '+330 minutes') = strftime('%Y-%m', 'now', '+330 minutes')`);
  res.json({
    today, month,
    toShip: one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('placed','paid')").n,
    lowStock: one('SELECT COUNT(*) AS n FROM variants WHERE stock <= ?', LOW_STOCK).n,
    customers: one("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").n,
    subscribers: one('SELECT COUNT(*) AS n FROM subscribers').n,
    lowStockThreshold: LOW_STOCK
  });
});

/* ------------------------------- inventory ------------------------------- */

adminRouter.get('/inventory', (_req, res) => {
  res.json({ products: listProducts({ includeInactive: true }), lowStockThreshold: LOW_STOCK });
});

adminRouter.patch('/variants/:id', (req, res) => {
  const id = v.int(req.params.id, { min: 1 });
  const variant = one('SELECT * FROM variants WHERE id = ?', id);
  if (!variant) throw new HttpError(404, 'Variant not found');
  const b = req.body;
  const stock = b.stock === undefined ? variant.stock : v.int(b.stock, { max: 100000, name: 'Stock' });
  const price = b.price === undefined ? variant.price : v.int(b.price, { min: 1, max: 1000000, name: 'Price' });
  const mrp = b.mrp === undefined ? variant.mrp : (b.mrp === null || b.mrp === '' ? null : v.int(b.mrp, { min: 1, max: 1000000, name: 'MRP' }));
  if (mrp !== null && mrp <= price) throw new HttpError(400, 'MRP must be higher than the price (or leave it empty)');

  tx(() => {
    run('UPDATE variants SET stock = ?, price = ?, mrp = ? WHERE id = ?', stock, price, mrp, id);
    if (stock !== variant.stock) logStock(id, stock - variant.stock, v.text(b.reason, 120) || 'Stock updated by admin', req.user.id);
    run("UPDATE products SET updated_at = datetime('now') WHERE id = ?", variant.product_id);
  });
  res.json({ variant: one('SELECT id, label, sku, price, mrp, stock FROM variants WHERE id = ?', id) });
});

adminRouter.patch('/products/:id', (req, res) => {
  const product = one('SELECT id FROM products WHERE id = ?', String(req.params.id));
  if (!product) throw new HttpError(404, 'Product not found');
  if (typeof req.body.active !== 'boolean') throw new HttpError(400, 'active must be true or false');
  run("UPDATE products SET active = ?, updated_at = datetime('now') WHERE id = ?", req.body.active ? 1 : 0, product.id);
  res.json({ ok: true });
});

adminRouter.get('/inventory/log', (_req, res) => {
  res.json({
    log: all(`SELECT l.id, l.delta, l.stock_after, l.reason, l.created_at, v.label, v.sku, p.name, u.email AS by_email
              FROM inventory_log l JOIN variants v ON v.id = l.variant_id JOIN products p ON p.id = v.product_id
              LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 100`)
  });
});

/* --------------------------------- orders -------------------------------- */

const STATUSES = ['pending_payment', 'placed', 'paid', 'shipped', 'delivered', 'cancelled'];

adminRouter.get('/orders', (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : null;
  const q = v.text(req.query.q, 80);
  const rows = all(`SELECT o.*, u.name AS customer_name FROM orders o JOIN users u ON u.id = o.user_id
                    WHERE (? IS NULL OR o.status = ?) AND (? = '' OR o.number LIKE ? OR o.email LIKE ? OR o.phone LIKE ?)
                    ORDER BY o.id DESC LIMIT 200`, status, status, q, `%${q}%`, `%${q}%`, `%${q}%`);
  res.json({ orders: rows.map(o => ({ ...serializeOrder(o, { admin: true }), customerName: o.customer_name })) });
});

adminRouter.patch('/orders/:number', (req, res) => {
  const order = getOrderByNumber(String(req.params.number));
  if (!order) throw new HttpError(404, 'Order not found');
  const status = String(req.body.status || '');
  if (!['placed', 'paid', 'shipped', 'delivered', 'cancelled'].includes(status)) throw new HttpError(400, 'Unknown status');
  if (order.status === 'cancelled' && status !== 'cancelled') throw new HttpError(400, 'Cancelled orders cannot be reopened — ask the customer to order again');
  if (order.status === 'pending_payment' && status !== 'cancelled') throw new HttpError(400, 'This order has not been paid yet');

  if (status === 'cancelled') cancelOrder(order, 'Cancelled by admin');
  else run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", status, order.id);
  if (typeof req.body.adminNote === 'string') run('UPDATE orders SET admin_note = ? WHERE id = ?', v.text(req.body.adminNote, 500), order.id);
  res.json({ order: serializeOrder(getOrderByNumber(order.number), { admin: true }) });
});

/* ------------------------------- messages -------------------------------- */

adminRouter.get('/messages', (_req, res) => {
  res.json({
    messages: all('SELECT * FROM messages ORDER BY id DESC LIMIT 200'),
    subscribers: all('SELECT email, created_at FROM subscribers ORDER BY created_at DESC LIMIT 500')
  });
});
