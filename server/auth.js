import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { one, run } from './db.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'virna_session';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = config.sessionDays * 86400;
  await run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + maxAge * 1000);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: maxAge * 1000, path: '/' });
}

export async function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

// Attaches req.user (or null) from the session cookie.
export async function loadUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = await one(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
                     WHERE s.token_hash = ? AND s.expires_at > ?`, sha256(token), Date.now());
    if (row) req.user = row;
  }
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Please sign in first');
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Please sign in first');
  if (req.user.role !== 'admin') throw new HttpError(403, 'Admins only');
  next();
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role,
    address: u.last_address ? JSON.parse(u.last_address) : null,
    hasPassword: Boolean(u.password_hash), google: Boolean(u.google_sub)
  };
}

export async function purgeExpiredSessions() {
  await run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
  await run('DELETE FROM rate_limits WHERE reset_at <= ?', Date.now());
}

// Simple fixed-window limiter for login-style endpoints (per IP + key).
// Kept in the database so every function instance shares the same counts.
export async function rateLimit(key, { max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const now = Date.now();
  const { count } = await one(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at < ? THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at < ? THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
    RETURNING count`, key, now + windowMs, now, now);
  if (count > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}
