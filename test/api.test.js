import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'virna-test-'));
Object.assign(process.env, {
  VIRNA_SKIP_ENV_FILE: '1',
  NODE_ENV: 'test',
  DATABASE_PATH: path.join(tmp, 'test.db'),
  ADMIN_1_EMAIL: 'admin@virna.test',
  ADMIN_1_PASSWORD: 'admin-pass-123',
  GOOGLE_CLIENT_ID: '',
  RAZORPAY_KEY_ID: '',
  RAZORPAY_KEY_SECRET: '',
  TURSO_DATABASE_URL: ''
});

const { createApp } = await import('../server/app.js');
const { seedCatalog, ensureAdmins } = await import('../server/seed.js');
const { migrate } = await import('../server/db.js');

let server, base;
before(async () => {
  await migrate();
  await seedCatalog();
  await ensureAdmins();
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// Tiny cookie-keeping client.
function client() {
  let cookie = '';
  return async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

const address = { firstName: 'Asha', lastName: 'Rao', line1: '12 Lake Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
const stockOf = async (api, variantId) => (await api('/products')).data.products.flatMap(p => p.sizes).find(s => s.id === variantId).stock;

test('catalogue is seeded and public', async () => {
  const api = client();
  const { status, data } = await api('/products');
  assert.equal(status, 200);
  assert.equal(data.products.length, 15);
  assert.ok(data.products[0].sizes[0].id);
});

test('checkout requires sign-in', async () => {
  const api = client();
  const r = await api('/orders', { method: 'POST', body: { items: [{ variantId: 1, qty: 1 }] } });
  assert.equal(r.status, 401);
});

test('writes must be JSON', async () => {
  const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a' });
  assert.equal(r.status, 415);
});

test('customer: register, order COD, stock goes down', async () => {
  const api = client();
  const reg = await api('/auth/register', { method: 'POST', body: { name: 'Asha', email: 'asha@example.com', password: 'secret-123' } });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.role, 'customer');

  const before = await stockOf(api, 1);
  const r = await api('/orders', { method: 'POST', body: { items: [{ variantId: 1, qty: 2 }], address, phone: '9876543210', payMethod: 'cod' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.order.status, 'placed');
  assert.equal(r.data.order.subtotal, 189 * 2);
  assert.equal(r.data.order.shipping, 79);
  assert.equal(await stockOf(api, 1), before - 2);

  const mine = await api('/account/orders');
  assert.equal(mine.data.orders.length, 1);
  assert.equal((await api('/auth/me')).data.user.address.city, 'Pune');
});

test('cannot buy more than is in stock', async () => {
  const api = client();
  await api('/auth/register', { method: 'POST', body: { name: 'B', email: 'b@example.com', password: 'secret-123' } });
  const r = await api('/orders', { method: 'POST', body: { items: [{ variantId: 1, qty: 99 }], address, phone: '9876543210', payMethod: 'cod' } });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Only \d+ left/);
});

test('online order: simulated payment marks it paid; cancelling releases stock', async () => {
  const api = client();
  await api('/auth/register', { method: 'POST', body: { name: 'C', email: 'c@example.com', password: 'secret-123' } });
  const start = await stockOf(api, 3);

  const a = await api('/orders', { method: 'POST', body: { items: [{ variantId: 3, qty: 1 }], address, phone: '9876543210', payMethod: 'online' } });
  assert.equal(a.data.order.status, 'pending_payment');
  assert.equal(a.data.payment.mode, 'simulated');
  const paid = await api(`/orders/${a.data.order.number}/simulate-payment`, { method: 'POST', body: {} });
  assert.equal(paid.data.order.status, 'paid');

  const b = await api('/orders', { method: 'POST', body: { items: [{ variantId: 3, qty: 2 }], address, phone: '9876543210', payMethod: 'online' } });
  assert.equal(await stockOf(api, 3), start - 3);
  const c = await api(`/orders/${b.data.order.number}/cancel`, { method: 'POST', body: {} });
  assert.equal(c.data.order.status, 'cancelled');
  assert.equal(await stockOf(api, 3), start - 1);
});

test('customers cannot see other orders or the admin API', async () => {
  const one = client(), two = client();
  await one('/auth/register', { method: 'POST', body: { name: 'D', email: 'd@example.com', password: 'secret-123' } });
  await two('/auth/register', { method: 'POST', body: { name: 'E', email: 'e@example.com', password: 'secret-123' } });
  const o = await one('/orders', { method: 'POST', body: { items: [{ variantId: 2, qty: 1 }], address, phone: '9876543210', payMethod: 'cod' } });
  assert.equal((await two(`/orders/${o.data.order.number}`)).status, 404);
  assert.equal((await two('/admin/inventory')).status, 403);
  assert.equal((await client()('/admin/inventory')).status, 401);
});

test('admin: update stock and price, cancel order restores stock', async () => {
  const admin = client();
  assert.equal((await admin('/auth/login', { method: 'POST', body: { email: 'admin@virna.test', password: 'wrong' } })).status, 401);
  const login = await admin('/auth/login', { method: 'POST', body: { email: 'ADMIN@virna.test', password: 'admin-pass-123' } });
  assert.equal(login.data.user.role, 'admin');

  const upd = await admin('/admin/variants/5', { method: 'PATCH', body: { stock: 7, price: 309, mrp: 349 } });
  assert.equal(upd.status, 200);
  assert.deepEqual([upd.data.variant.stock, upd.data.variant.price, upd.data.variant.mrp], [7, 309, 349]);
  assert.equal((await admin('/admin/variants/5', { method: 'PATCH', body: { stock: -1 } })).status, 400);
  assert.equal((await admin('/admin/variants/5', { method: 'PATCH', body: { mrp: 100 } })).status, 400);
  const log = await admin('/admin/inventory/log');
  assert.equal(log.data.log[0].by_email, 'admin@virna.test');

  const orders = (await admin('/admin/orders?status=placed')).data.orders;
  const target = orders[0];
  const vid = target.items[0].variant_id;
  const before = await stockOf(admin, vid);
  const r = await admin(`/admin/orders/${target.number}`, { method: 'PATCH', body: { status: 'cancelled' } });
  assert.equal(r.data.order.status, 'cancelled');
  assert.equal(await stockOf(admin, vid), before + target.items[0].qty);
  assert.equal((await admin(`/admin/orders/${target.number}`, { method: 'PATCH', body: { status: 'shipped' } })).status, 400);

  const hide = await admin('/admin/products/P02', { method: 'PATCH', body: { active: false } });
  assert.equal(hide.status, 200);
  assert.equal((await admin('/products')).data.products.length, 14);
  assert.equal((await admin('/admin/inventory')).data.products.length, 15);
});

test('signing up with an admin email is refused', async () => {
  const r = await client()('/auth/register', { method: 'POST', body: { name: 'X', email: 'admin@virna.test', password: 'secret-123' } });
  assert.equal(r.status, 409);
});

test('two customers racing for the last item: exactly one wins', async () => {
  const admin = client();
  await admin('/auth/login', { method: 'POST', body: { email: 'admin@virna.test', password: 'admin-pass-123' } });
  await admin('/admin/variants/7', { method: 'PATCH', body: { stock: 1 } });
  const a = client(), b = client();
  await a('/auth/register', { method: 'POST', body: { name: 'F', email: 'f@example.com', password: 'secret-123' } });
  await b('/auth/register', { method: 'POST', body: { name: 'G', email: 'g@example.com', password: 'secret-123' } });
  const body = { items: [{ variantId: 7, qty: 1 }], address, phone: '9876543210', payMethod: 'cod' };
  const results = await Promise.all([a('/orders', { method: 'POST', body }), b('/orders', { method: 'POST', body })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal(await stockOf(admin, 7), 0);
});
