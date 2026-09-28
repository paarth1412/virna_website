import { Router } from 'express';
import { config } from '../config.js';
import { all, run } from '../db.js';
import { rateLimit } from '../auth.js';
import { listProducts } from '../store.js';
import * as v from '../validate.js';

export const shopRouter = Router();

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

shopRouter.get('/categories', (_req, res) => {
  res.json({ categories: all('SELECT slug, name, note, art, tone FROM categories ORDER BY sort') });
});

shopRouter.get('/products', (_req, res) => {
  res.json({ products: listProducts() });
});

shopRouter.post('/newsletter', (req, res) => {
  rateLimit(`news:${req.ip}`, { max: 20 });
  run('INSERT OR IGNORE INTO subscribers (email) VALUES (?)', v.email(req.body.email));
  res.json({ ok: true });
});

shopRouter.post('/contact', (req, res) => {
  rateLimit(`contact:${req.ip}`, { max: 10 });
  const name = v.required(v.text(req.body.name, 80), 'Please enter your name');
  const email = v.email(req.body.email);
  const body = v.required(v.text(req.body.message, 4000), 'Please write a message');
  run('INSERT INTO messages (name, email, topic, body) VALUES (?, ?, ?, ?)', name, email, v.text(req.body.topic, 80), body);
  res.json({ ok: true });
});
