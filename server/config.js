import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile) && !process.env.VIRNA_SKIP_ENV_FILE) process.loadEnvFile(envFile);

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT) || 4390;

// ADMIN_1_EMAIL / ADMIN_1_PASSWORD, ADMIN_2_EMAIL / ADMIN_2_PASSWORD, ...
const admins = [];
for (let i = 1; i <= 9; i++) {
  const email = env[`ADMIN_${i}_EMAIL`]?.trim().toLowerCase();
  if (email) admins.push({ email, password: env[`ADMIN_${i}_PASSWORD`] || '' });
}

const razorpay = {
  keyId: env.RAZORPAY_KEY_ID || '',
  keySecret: env.RAZORPAY_KEY_SECRET || '',
  webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || ''
};
const razorpayReady = Boolean(razorpay.keyId && razorpay.keySecret);

export const config = {
  root,
  isProd,
  port,
  dbPath: env.DATABASE_PATH || path.join(root, 'data', 'virna.db'),
  turso: { url: env.TURSO_DATABASE_URL || '', authToken: env.TURSO_AUTH_TOKEN || '' },
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  razorpay,
  razorpayReady,
  // Without Razorpay keys, online payments are simulated in development and switched off in production.
  simulatePayments: !razorpayReady && !isProd,
  onlinePayments: razorpayReady || !isProd,
  admins,
  sessionDays: 30,
  pendingPaymentMinutes: 30,
  freeShippingOver: 999,
  shippingFee: 79
};
