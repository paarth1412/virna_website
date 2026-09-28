import crypto from 'node:crypto';
import { config } from './config.js';
import { all, one, run, tx } from './db.js';

/* ------------------------------- catalogue ------------------------------- */

export function listProducts({ includeInactive = false } = {}) {
  const products = all(`SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, name`);
  const variants = all('SELECT * FROM variants ORDER BY product_id, sort, id');
  const byProduct = Map.groupBy(variants, v => v.product_id);
  return products.map(p => serializeProduct(p, byProduct.get(p.id) || []));
}

function serializeProduct(p, variants) {
  const art = JSON.parse(p.art || '{}');
  return {
    ...art,
    art: art.type,
    id: p.id, slug: p.slug, name: p.name, category: p.category, tag: p.tag,
    short: p.short, desc: p.description, use: p.usage,
    made: JSON.parse(p.made || '[]'),
    includes: p.includes ? JSON.parse(p.includes) : null,
    image: p.image_url, active: Boolean(p.active),
    sizes: variants.map(v => ({ id: v.id, label: v.label, sku: v.sku, price: v.price, mrp: v.mrp, stock: v.stock }))
  };
}

export function logStock(variantId, delta, reason, userId = null) {
  const { stock } = one('SELECT stock FROM variants WHERE id = ?', variantId);
  run('INSERT INTO inventory_log (variant_id, delta, stock_after, reason, user_id) VALUES (?, ?, ?, ?, ?)', variantId, delta, stock, reason, userId);
}

/* --------------------------------- orders -------------------------------- */

export const shippingFor = subtotal => (subtotal === 0 || subtotal >= config.freeShippingOver ? 0 : config.shippingFee);

function newOrderNumber() {
  for (;;) {
    const n = 'VRN' + crypto.randomInt(100000, 999999);
    if (!one('SELECT 1 FROM orders WHERE number = ?', n)) return n;
  }
}

// Validates the cart against live prices and stock, reserves stock and writes the order.
// Must be called inside tx().
export function createOrder({ user, items, address, phone, payMethod, giftMessage }) {
  const lines = items.map(({ variantId, qty }) => {
    const v = one(`SELECT v.*, p.name AS product_name, p.active FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`, variantId);
    if (!v || !v.active) throw Object.assign(new Error('One of the items in your cart is no longer available'), { status: 409 });
    if (v.stock < qty) {
      const msg = v.stock === 0 ? `${v.product_name} (${v.label}) just sold out` : `Only ${v.stock} left of ${v.product_name} (${v.label})`;
      throw Object.assign(new Error(msg), { status: 409 });
    }
    return { v, qty };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.v.price * l.qty, 0);
  const shipping = shippingFor(subtotal);
  const number = newOrderNumber();
  const status = payMethod === 'cod' ? 'placed' : 'pending_payment';

  const { lastInsertRowid } = run(`INSERT INTO orders (number, user_id, status, pay_method, subtotal, shipping, total, email, phone, address, gift_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    number, user.id, status, payMethod, subtotal, shipping, subtotal + shipping, user.email, phone, JSON.stringify(address), giftMessage);
  const orderId = Number(lastInsertRowid);

  for (const { v, qty } of lines) {
    run('INSERT INTO order_items (order_id, product_id, variant_id, name, size, price, qty) VALUES (?, ?, ?, ?, ?, ?, ?)',
      orderId, v.product_id, v.id, v.product_name, v.label, v.price, qty);
    run('UPDATE variants SET stock = stock - ? WHERE id = ?', qty, v.id);
    logStock(v.id, -qty, `Order ${number}`);
  }

  run('UPDATE users SET last_address = ?, phone = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE id = ?',
    JSON.stringify(address), phone, `${address.firstName} ${address.lastName}`.trim(), user.id);
  return getOrder(orderId);
}

export function getOrder(id) {
  return one('SELECT * FROM orders WHERE id = ?', id);
}

export function getOrderByNumber(number) {
  return one('SELECT * FROM orders WHERE number = ?', number);
}

export function serializeOrder(o, { admin = false } = {}) {
  const items = all('SELECT product_id, variant_id, name, size, price, qty FROM order_items WHERE order_id = ? ORDER BY id', o.id);
  const out = {
    number: o.number, status: o.status, payMethod: o.pay_method,
    subtotal: o.subtotal, shipping: o.shipping, total: o.total,
    email: o.email, phone: o.phone, address: JSON.parse(o.address), giftMessage: o.gift_message,
    createdAt: o.created_at, items: items.map(i => ({ ...i, amount: i.price * i.qty }))
  };
  if (admin) Object.assign(out, { paymentId: o.razorpay_payment_id, razorpayOrderId: o.razorpay_order_id, adminNote: o.admin_note, updatedAt: o.updated_at });
  return out;
}

// Puts an order's items back on the shelf (once).
export function releaseStock(order, reason) {
  if (order.stock_released) return;
  for (const i of all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', order.id)) {
    const res = run('UPDATE variants SET stock = stock + ? WHERE id = ?', i.qty, i.variant_id);
    if (res.changes) logStock(i.variant_id, i.qty, reason);
  }
  run('UPDATE orders SET stock_released = 1 WHERE id = ?', order.id);
}

export function cancelOrder(order, reason) {
  tx(() => {
    const fresh = getOrder(order.id);
    if (fresh.status === 'cancelled') return;
    releaseStock(fresh, `${reason} (${fresh.number})`);
    run("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", fresh.id);
  });
}

// Records a successful online payment. Safe to call more than once (client callback + webhook).
export function markPaid(order, paymentId) {
  return tx(() => {
    const o = getOrder(order.id);
    if (['paid', 'shipped', 'delivered'].includes(o.status)) return o;
    if (o.status === 'cancelled' && o.stock_released) {
      // Paid after the order had expired — try to take the stock again.
      const items = all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', o.id);
      const enough = items.every(i => (one('SELECT stock FROM variants WHERE id = ?', i.variant_id)?.stock ?? 0) >= i.qty);
      if (enough) {
        for (const i of items) { run('UPDATE variants SET stock = stock - ? WHERE id = ?', i.qty, i.variant_id); logStock(i.variant_id, -i.qty, `Order ${o.number} (late payment)`); }
        run('UPDATE orders SET stock_released = 0 WHERE id = ?', o.id);
      } else {
        run("UPDATE orders SET admin_note = 'Paid after the order expired and stock ran out — refund or restock before shipping.' WHERE id = ?", o.id);
      }
    }
    run("UPDATE orders SET status = 'paid', razorpay_payment_id = ?, updated_at = datetime('now') WHERE id = ?", paymentId, o.id);
    return getOrder(o.id);
  });
}

// Online orders that were never paid give their stock back after a while.
export function expireUnpaidOrders() {
  const stale = all(`SELECT * FROM orders WHERE status = 'pending_payment' AND created_at < datetime('now', ?)`, `-${config.pendingPaymentMinutes} minutes`);
  for (const o of stale) cancelOrder(o, 'Payment not completed');
  return stale.length;
}
