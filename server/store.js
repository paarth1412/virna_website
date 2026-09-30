import crypto from 'node:crypto';
import { config } from './config.js';
import { db, tx } from './db.js';

const stockError = message => Object.assign(new Error(message), { status: 409 });

/* ------------------------------- catalogue ------------------------------- */

export async function listProducts({ includeInactive = false } = {}) {
  const [products, variants] = await Promise.all([
    db.all(`SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, name`),
    db.all('SELECT * FROM variants ORDER BY product_id, sort, id')
  ]);
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

export async function logStock(q, variantId, delta, reason, userId = null) {
  const { stock } = await q.one('SELECT stock FROM variants WHERE id = ?', variantId);
  await q.run('INSERT INTO inventory_log (variant_id, delta, stock_after, reason, user_id) VALUES (?, ?, ?, ?, ?)', variantId, delta, stock, reason, userId);
}

/* --------------------------------- orders -------------------------------- */

export const shippingFor = subtotal => (subtotal === 0 || subtotal >= config.freeShippingOver ? 0 : config.shippingFee);

async function newOrderNumber(q) {
  for (;;) {
    const n = 'VRN' + crypto.randomInt(100000, 999999);
    if (!await q.one('SELECT 1 AS x FROM orders WHERE number = ?', n)) return n;
  }
}

// Validates the cart against live prices and stock, reserves stock and writes the order — all in one transaction.
export function createOrder({ user, items, address, phone, payMethod, giftMessage }) {
  return tx(async q => {
    const lines = [];
    for (const { variantId, qty } of items) {
      const v = await q.one('SELECT v.*, p.name AS product_name, p.active FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?', variantId);
      if (!v || !v.active) throw stockError('One of the items in your cart is no longer available');
      if (v.stock < qty) throw stockError(v.stock === 0 ? `${v.product_name} (${v.label}) just sold out` : `Only ${v.stock} left of ${v.product_name} (${v.label})`);
      lines.push({ v, qty });
    }
    const subtotal = lines.reduce((sum, l) => sum + l.v.price * l.qty, 0);
    const shipping = shippingFor(subtotal);
    const number = await newOrderNumber(q);
    const status = payMethod === 'cod' ? 'placed' : 'pending_payment';

    const { lastInsertRowid: orderId } = await q.run(`INSERT INTO orders (number, user_id, status, pay_method, subtotal, shipping, total, email, phone, address, gift_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      number, user.id, status, payMethod, subtotal, shipping, subtotal + shipping, user.email, phone, JSON.stringify(address), giftMessage);

    for (const { v, qty } of lines) {
      await q.run('INSERT INTO order_items (order_id, product_id, variant_id, name, size, price, qty) VALUES (?, ?, ?, ?, ?, ?, ?)',
        orderId, v.product_id, v.id, v.product_name, v.label, v.price, qty);
      // The stock guard in the WHERE clause makes overselling impossible even under concurrent checkouts.
      const { changes } = await q.run('UPDATE variants SET stock = stock - ? WHERE id = ? AND stock >= ?', qty, v.id, qty);
      if (!changes) throw stockError(`${v.product_name} (${v.label}) just sold out`);
      await logStock(q, v.id, -qty, `Order ${number}`);
    }

    await q.run("UPDATE users SET last_address = ?, phone = ?, name = CASE WHEN name = '' THEN ? ELSE name END WHERE id = ?",
      JSON.stringify(address), phone, `${address.firstName} ${address.lastName}`.trim(), user.id);
    return q.one('SELECT * FROM orders WHERE id = ?', orderId);
  });
}

export const getOrderByNumber = (number, q = db) => q.one('SELECT * FROM orders WHERE number = ?', number);

export async function serializeOrder(o, { admin = false } = {}) {
  const items = await db.all('SELECT product_id, variant_id, name, size, price, qty FROM order_items WHERE order_id = ? ORDER BY id', o.id);
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
async function releaseStock(q, order, reason) {
  if (order.stock_released) return;
  for (const i of await q.all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', order.id)) {
    const res = await q.run('UPDATE variants SET stock = stock + ? WHERE id = ?', i.qty, i.variant_id);
    if (res.changes) await logStock(q, i.variant_id, i.qty, reason);
  }
  await q.run('UPDATE orders SET stock_released = 1 WHERE id = ?', order.id);
}

export function cancelOrder(order, reason) {
  return tx(async q => {
    const fresh = await q.one('SELECT * FROM orders WHERE id = ?', order.id);
    if (fresh.status === 'cancelled') return;
    await releaseStock(q, fresh, `${reason} (${fresh.number})`);
    await q.run("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", fresh.id);
  });
}

// Records a successful online payment. Safe to call more than once (client callback + webhook).
export function markPaid(order, paymentId) {
  return tx(async q => {
    const o = await q.one('SELECT * FROM orders WHERE id = ?', order.id);
    if (['paid', 'shipped', 'delivered'].includes(o.status)) return o;
    if (o.status === 'cancelled' && o.stock_released) {
      // Paid after the order had expired — try to take the stock again.
      const items = await q.all('SELECT variant_id, qty FROM order_items WHERE order_id = ?', o.id);
      let enough = true;
      for (const i of items) if (((await q.one('SELECT stock FROM variants WHERE id = ?', i.variant_id))?.stock ?? 0) < i.qty) enough = false;
      if (enough) {
        for (const i of items) {
          await q.run('UPDATE variants SET stock = stock - ? WHERE id = ?', i.qty, i.variant_id);
          await logStock(q, i.variant_id, -i.qty, `Order ${o.number} (late payment)`);
        }
        await q.run('UPDATE orders SET stock_released = 0 WHERE id = ?', o.id);
      } else {
        await q.run("UPDATE orders SET admin_note = 'Paid after the order expired and stock ran out — refund or restock before shipping.' WHERE id = ?", o.id);
      }
    }
    await q.run("UPDATE orders SET status = 'paid', razorpay_payment_id = ?, updated_at = datetime('now') WHERE id = ?", paymentId, o.id);
    return q.one('SELECT * FROM orders WHERE id = ?', o.id);
  });
}

// Online orders that were never paid give their stock back after a while.
export async function expireUnpaidOrders() {
  const stale = await db.all("SELECT * FROM orders WHERE status = 'pending_payment' AND created_at < datetime('now', ?)", `-${config.pendingPaymentMinutes} minutes`);
  for (const o of stale) await cancelOrder(o, 'Payment not completed');
  return stale.length;
}
