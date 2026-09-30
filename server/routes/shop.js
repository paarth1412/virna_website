import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { rateLimit } from '../auth.js';
import { listProducts } from '../store.js';
import * as v from '../validate.js';

export const shopRouter = Router();

// Used by uptime monitors to keep the free server awake; also checks the database.
shopRouter.get('/health', async (_req, res) => {
  await db.one('SELECT 1 AS ok');
  res.json({ ok: true });
});

shopRouter.get('/config', (_req, res) => {
  res.json({
    googleClientId: config.googleClientId,
    razorpayKeyId: config.razorpayReady ? config.razorpay.keyId : '',
    onlinePayments: config.onlinePayments,
    simulatedPayments: config.simulatePayments,
    freeShippingOver: config.freeShippingOver,
    shippingFee: config.shippingFee,
    states: v.STATES
  });
});

shopRouter.get('/categories', async (_req, res) => {
  res.json({ categories: await db.all('SELECT slug, name, note, art, tone FROM categories ORDER BY sort') });
});

shopRouter.get('/products', async (_req, res) => {
  res.json({ products: await listProducts() });
});

shopRouter.post('/newsletter', async (req, res) => {
  rateLimit(`news:${req.ip}`, { max: 20 });
  await db.run('INSERT OR IGNORE INTO subscribers (email) VALUES (?)', v.email(req.body.email));
  res.json({ ok: true });
});

shopRouter.post('/contact', async (req, res) => {
  rateLimit(`contact:${req.ip}`, { max: 10 });
  const name = v.required(v.text(req.body.name, 80), 'Please enter your name');
  const email = v.email(req.body.email);
  const body = v.required(v.text(req.body.message, 4000), 'Please write a message');
  await db.run('INSERT INTO messages (name, email, topic, body) VALUES (?, ?, ?, ?)', name, email, v.text(req.body.topic, 80), body);
  res.json({ ok: true });
});
