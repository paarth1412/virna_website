import { config } from './config.js';
import { createApp } from './app.js';
import { ensureAdmins, seedCatalog } from './seed.js';
import { expireUnpaidOrders } from './store.js';
import { purgeExpiredSessions } from './auth.js';

if (seedCatalog()) console.log('Seeded the sample catalogue');
await ensureAdmins();

setInterval(() => {
  const n = expireUnpaidOrders();
  if (n) console.log(`Released stock from ${n} unpaid order(s)`);
  purgeExpiredSessions();
}, 5 * 60 * 1000).unref();

createApp().listen(config.port, () => {
  console.log(`Virna running at http://localhost:${config.port}`);
  console.log(`Payments: ${config.razorpayReady ? 'Razorpay' : config.simulatePayments ? 'simulated (no Razorpay keys set)' : 'cash on delivery only'}`);
  console.log(`Google sign-in: ${config.googleClientId ? 'on' : 'off (GOOGLE_CLIENT_ID not set)'}`);
});
