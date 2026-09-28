import crypto from 'node:crypto';
import { config } from './config.js';

const { keyId, keySecret, webhookSecret } = config.razorpay;

// https://razorpay.com/docs/api/orders/create/
export async function createRazorpayOrder({ amountPaise, receipt, notes }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.description || 'Razorpay order creation failed');
  return data;
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Checkout callback: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
export function verifyPaymentSignature({ razorpayOrderId, paymentId, signature }) {
  const expected = crypto.createHmac('sha256', keySecret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

// Webhooks: signature = HMAC_SHA256(raw body, webhook secret)
export function verifyWebhookSignature(rawBody, signature) {
  if (!webhookSecret) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return safeEqual(expected, signature || '');
}
