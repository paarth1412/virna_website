import express, { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError, requireUser } from '../auth.js';
import { cancelOrder, createOrder, getOrderByNumber, markPaid, serializeOrder } from '../store.js';
import { createRazorpayOrder, verifyPaymentSignature, verifyWebhookSignature } from '../razorpay.js';
import * as v from '../validate.js';

export const ordersRouter = Router();
export const webhookRouter = Router();

// Loads :number and checks it belongs to the signed-in user (admins can see any order).
async function ownOrder(req) {
  const order = await getOrderByNumber(String(req.params.number));
  if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) throw new HttpError(404, 'Order not found');
  return order;
}

ordersRouter.use(requireUser);

ordersRouter.post('/', async (req, res) => {
  const { body } = req;
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) throw new HttpError(400, 'Your cart is empty');

  // Merge duplicate lines and validate quantities.
  const merged = new Map();
  for (const it of body.items) {
    const variantId = v.int(it?.variantId, { min: 1, name: 'Item' });
    const qty = v.int(it?.qty, { min: 1, max: 99, name: 'Quantity' });
    merged.set(variantId, (merged.get(variantId) || 0) + qty);
  }
  const items = [...merged].map(([variantId, qty]) => ({ variantId, qty }));

  const phone = v.text(body.phone, 10);
  if (!v.PHONE_RE.test(phone)) throw new HttpError(400, 'Enter a valid 10-digit mobile number');
  const address = v.address(body.address);
  const payMethod = body.payMethod === 'cod' ? 'cod' : 'online';
  if (payMethod === 'online' && !config.onlinePayments) throw new HttpError(400, 'Online payment is not available yet — please choose cash on delivery');

  let order = await createOrder({ user: req.user, items, address, phone, payMethod, giftMessage: v.text(body.giftMessage, 500) });

  let payment = null;
  if (payMethod === 'online') {
    if (config.razorpayReady) {
      try {
        const rzp = await createRazorpayOrder({ amountPaise: order.total * 100, receipt: order.number, notes: { order: order.number } });
        await db.run('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', rzp.id, order.id);
        payment = { mode: 'razorpay', keyId: config.razorpay.keyId, razorpayOrderId: rzp.id, amount: rzp.amount, currency: rzp.currency };
      } catch (err) {
        console.error('Razorpay order failed:', err.message);
        await cancelOrder(order, 'Payment gateway error');
        throw new HttpError(502, 'Could not start the payment. Please try again in a moment.');
      }
    } else {
      payment = { mode: 'simulated' };
    }
  }
  order = await getOrderByNumber(order.number);
  res.status(201).json({ order: await serializeOrder(order), payment });
});

ordersRouter.get('/:number', async (req, res) => {
  res.json({ order: await serializeOrder(await ownOrder(req)) });
});

// Razorpay Checkout success callback.
ordersRouter.post('/:number/verify', async (req, res) => {
  const order = await ownOrder(req);
  if (!config.razorpayReady || !order.razorpay_order_id) throw new HttpError(400, 'This order is not awaiting an online payment');
  const paymentId = v.text(req.body.razorpay_payment_id, 64);
  const ok = paymentId && verifyPaymentSignature({ razorpayOrderId: order.razorpay_order_id, paymentId, signature: v.text(req.body.razorpay_signature, 128) });
  if (!ok) throw new HttpError(400, 'Payment could not be verified. If money was deducted, contact us with your order number.');
  res.json({ order: await serializeOrder(await markPaid(order, paymentId)) });
});

// Development only: stands in for Razorpay until keys are added.
ordersRouter.post('/:number/simulate-payment', async (req, res) => {
  if (!config.simulatePayments) throw new HttpError(404, 'Not found');
  const order = await ownOrder(req);
  if (order.status !== 'pending_payment') throw new HttpError(400, 'This order is not awaiting payment');
  res.json({ order: await serializeOrder(await markPaid(order, `SIMULATED-${order.number}`)) });
});

// Customer closed the payment window — release the stock right away.
ordersRouter.post('/:number/cancel', async (req, res) => {
  const order = await ownOrder(req);
  if (order.status !== 'pending_payment') throw new HttpError(400, 'Only unpaid orders can be cancelled here');
  await cancelOrder(order, 'Payment cancelled by customer');
  res.json({ order: await serializeOrder(await getOrderByNumber(order.number)) });
});

/* ------------------------------- webhooks -------------------------------- */
// Razorpay dashboard → Webhooks → URL https://<your-domain>/api/webhooks/razorpay,
// events: payment.captured, order.paid. Catches payments where the browser closed early.
webhookRouter.post('/razorpay', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!verifyWebhookSignature(req.body, req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'Invalid signature' });
  const event = JSON.parse(req.body.toString('utf8'));
  const payment = event?.payload?.payment?.entity;
  if (['payment.captured', 'order.paid'].includes(event.event) && payment?.order_id) {
    const order = await db.one('SELECT * FROM orders WHERE razorpay_order_id = ?', payment.order_id);
    if (order) await markPaid(order, payment.id);
  }
  res.json({ ok: true });
});
