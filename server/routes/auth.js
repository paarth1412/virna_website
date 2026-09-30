import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError, endSession, hashPassword, publicUser, rateLimit, requireUser, startSession, verifyPassword } from '../auth.js';
import { serializeOrder } from '../store.js';
import * as v from '../validate.js';

export const authRouter = Router();
export const accountRouter = Router();
const google = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;
const isAdminEmail = email => config.admins.some(a => a.email === email.toLowerCase());
const userById = id => db.one('SELECT * FROM users WHERE id = ?', id);

authRouter.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

authRouter.post('/register', async (req, res) => {
  rateLimit(`register:${req.ip}`, { max: 20 });
  const name = v.required(v.text(req.body.name, 80), 'Please enter your name');
  const email = v.email(req.body.email);
  const password = v.password(req.body.password);
  if (await db.one('SELECT 1 AS x FROM users WHERE email = ?', email)) throw new HttpError(409, 'An account with this email already exists — please sign in');
  // Admin accounts are created at startup from the environment, so a sign-up is always a customer.
  const { lastInsertRowid } = await db.run('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)', email, name, await hashPassword(password));
  await startSession(res, lastInsertRowid);
  res.status(201).json({ user: publicUser(await userById(lastInsertRowid)) });
});

authRouter.post('/login', async (req, res) => {
  const email = v.text(req.body.email, 254).toLowerCase();
  rateLimit(`login:${req.ip}:${email}`);
  const user = await db.one('SELECT * FROM users WHERE email = ?', email);
  const ok = user && await verifyPassword(String(req.body.password || ''), user.password_hash);
  if (!ok) {
    if (user && !user.password_hash && user.google_sub) throw new HttpError(401, 'This account uses Google sign-in — use the Google button instead');
    throw new HttpError(401, 'Incorrect email or password');
  }
  await startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/google', async (req, res) => {
  if (!google) throw new HttpError(503, 'Google sign-in is not set up yet');
  rateLimit(`google:${req.ip}`, { max: 30 });
  let payload;
  try {
    const ticket = await google.verifyIdToken({ idToken: String(req.body.credential || ''), audience: config.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, 'Google sign-in failed — please try again');
  }
  if (!payload?.email || !payload.email_verified) throw new HttpError(401, 'Your Google email is not verified');
  const email = payload.email.toLowerCase();

  let user = await db.one('SELECT * FROM users WHERE google_sub = ?', payload.sub) || await db.one('SELECT * FROM users WHERE email = ?', email);
  if (!user) {
    const { lastInsertRowid } = await db.run('INSERT INTO users (email, name, google_sub, role) VALUES (?, ?, ?, ?)',
      email, payload.name || '', payload.sub, isAdminEmail(email) ? 'admin' : 'customer');
    user = await userById(lastInsertRowid);
  } else if (!user.google_sub) {
    await db.run("UPDATE users SET google_sub = ?, name = CASE WHEN name = '' THEN ? ELSE name END WHERE id = ?", payload.sub, payload.name || '', user.id);
    user = await userById(user.id);
  }
  await startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

/* -------------------------------- account -------------------------------- */

accountRouter.use(requireUser);

accountRouter.get('/orders', async (req, res) => {
  const orders = await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id);
  res.json({ orders: await Promise.all(orders.map(o => serializeOrder(o))) });
});

accountRouter.patch('/profile', async (req, res) => {
  const name = v.required(v.text(req.body.name, 80), 'Please enter your name');
  const phone = v.text(req.body.phone, 10);
  if (phone && !v.PHONE_RE.test(phone)) throw new HttpError(400, 'Enter a 10-digit mobile number');
  await db.run('UPDATE users SET name = ?, phone = ? WHERE id = ?', name, phone, req.user.id);
  res.json({ user: publicUser(await userById(req.user.id)) });
});

accountRouter.post('/password', async (req, res) => {
  rateLimit(`password:${req.user.id}`);
  const next = v.password(req.body.newPassword);
  if (req.user.password_hash && !await verifyPassword(String(req.body.currentPassword || ''), req.user.password_hash)) {
    throw new HttpError(400, 'Your current password is incorrect');
  }
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), req.user.id);
  // Sign out other devices, keep this one.
  await db.run('DELETE FROM sessions WHERE user_id = ?', req.user.id);
  await startSession(res, req.user.id);
  res.json({ ok: true });
});
