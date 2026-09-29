import crypto from 'node:crypto';
import { config } from './config.js';
import { all, one, run, tx } from './db.js';

/* ------------------------------- catalogue ------------------------------- */

export async function listProducts({ includeInactive = false } = {}) {
  const products = await all(`SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, name`);
  const variants = await all('SELECT * FROM variants ORDER BY product_id, sort, id');
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

export async function logStock(variantId, delta, reason, userId = null) {
  const { stock } = await one('SELECT stock FROM variants WHERE id = ?', variantId);
  await run('INSERT INTO inventory_log (variant_id, delta, stock_after, reason, user_id) VALUES (?, ?, ?, ?, ?)', variantId, delta, stock, reason, userId);
}

/* --------------------------------- orders -------------------------------- */

export const shippingFor = subtotal => (subtotal === 0 || subtotal >= config.freeShippingOver ? 0 : config.shippingFee);

async function newOrderNumber() {
  for (;;) {
    const n = 'VRN' + crypto.randomInt(100000, 999999);
    if (!await one('SELECT 1 FROM orders WHERE number = ?', n)) return n;
  }
}

// Validates the cart against live prices and stock, reserves stock and writes the order.
// Must be called inside tx().
export async function createOrder({ user, items, address, phone, payMethod, giftMessage }) {
  const lines = [];
  // Lock in id order so concurrent checkouts can't deadlock.
  for (const { variantId, qty } of items.toSorted((a, b) => a.variantId - b.variantId)) {
    const v = await one(`SELECT v.*, p.name AS product_name, p.active FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? FOR UPDATE OF v`, variantId);
    if (!v || !v.active) throw Object.assign(new Error('One of the items in your cart is no longer available'), { status: 409 });
    if (v.stock < qty) {
      const msg = v.stock === 0 ? `${v.product_name} (${v.label}) just sold out` : `Only ${v.stock} left of ${v.product_name} (${v.label})`;
      throw Object.assign(new Error(msg), { status: 409 });
    }
    lines.push({ v, qty });
  }
  const subtotal = lines.reduce((sum, l) => sum + l.v.price * l.qty, 0);
  const shipping = shippingFor(subtotal);
  const number = await newOrderNumber();
  const status = payMethod === 'cod' ? 'placed' : 'pending_payment';

  const { id: orderId } = await one(`INSERT INTO orders (number, user_id, status, pay_method, subtotal, shipping, total, email, phone, address, gift_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    number, user.id, status, payMethod, subtotal, shipping, subtotal + shipping, user.email, phone, JSON.stringify(address), giftMessage);

  for (const { v, qty } of lines) {
    await run('INSERT INTO order_items (order_id, product_id, variant_id, name, size, price, qty) VALUES (?, ?, ?, ?, ?, ?, ?)',
      orderId, v.product_id, v.id, v.product_name, v.label, v.price, qty);
    await run('UPDATE variants SET stock = stock - ? WHERE id = ?', qty, v.id);
    await logStock(v.id, -qty, `Order ${number}`);
  }

  await run('UPDATE users SET last_address = ?, phone = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE id = ?',
    JSON.stringify(address), phone, `${address.firstName} ${address.lastName}`.trim(), user.id);
  return getOrder(orderId);
}

export function getOrder(id, { lock = false } = {}) {
  return one(`SELECT * FROM orders WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, id);
}

export function getOrderByNumber(number) {
  return one('SELECT * FROM orders WHERE number = ?', number);
}

export async function serializeOrder(o, { admin = false } = {}) {
  const items = await all('SELECT product_id, variant_id, name, size, price, qty FROM order_items WHERE order_id = ? ORDER BY id', o.id);
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
export async function releaseStock(order, reason) {
  if (order.stock_released) return;
  for (const i of await all('SELECT variant_id, qty FROM order_items WHERE order_id = ? ORDER BY variant_id', order.id)) {
    const res = await run('UPDATE variants SET stock = stock + ? WHERE id = ?', i.qty, i.variant_id);
    if (res.changes) await logStock(i.variant_id, i.qty, reason);
  }
  await run('UPDATE orders SET stock_released = 1 WHERE id = ?', order.id);
}

export function cancelOrder(order, reason) {
  return tx(async () => {
    const fresh = await getOrder(order.id, { lock: true });
    if (fresh.status === 'cancelled') return;
    await releaseStock(fresh, `${reason} (${fresh.number})`);
    await run("UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = ?", fresh.id);
  });
}

// Records a successful online payment. Safe to call more than once (client callback + webhook).
export function markPaid(order, paymentId) {
  return tx(async () => {
    const o = await getOrder(order.id, { lock: true });
    if (['paid', 'shipped', 'delivered'].includes(o.status)) return o;
    if (o.status === 'cancelled' && o.stock_released) {
      // Paid after the order had expired — try to take the stock again.
      const items = await all('SELECT variant_id, qty FROM order_items WHERE order_id = ? ORDER BY variant_id', o.id);
      let enough = true;
      for (const i of items) {
        const row = await one('SELECT stock FROM variants WHERE id = ? FOR UPDATE', i.variant_id);
        if ((row?.stock ?? 0) < i.qty) enough = false;
      }
      if (enough) {
        for (const i of items) { await run('UPDATE variants SET stock = stock - ? WHERE id = ?', i.qty, i.variant_id); await logStock(i.variant_id, -i.qty, `Order ${o.number} (late payment)`); }
        await run('UPDATE orders SET stock_released = 0 WHERE id = ?', o.id);
      } else {
        await run("UPDATE orders SET admin_note = 'Paid after the order expired and stock ran out — refund or restock before shipping.' WHERE id = ?", o.id);
      }
    }
    await run("UPDATE orders SET status = 'paid', razorpay_payment_id = ?, updated_at = now() WHERE id = ?", paymentId, o.id);
    return getOrder(o.id);
  });
}

// Online orders that were never paid give their stock back after a while.
export async function expireUnpaidOrders() {
  const stale = await all(`SELECT * FROM orders WHERE status = 'pending_payment' AND created_at < now() - make_interval(mins => ?::int)`, config.pendingPaymentMinutes);
  for (const o of stale) await cancelOrder(o, 'Payment not completed');
  return stale.length;
}
