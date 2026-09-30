import { config } from './config.js';
import { createApp } from './app.js';
import { migrate, usingTurso } from './db.js';
import { ensureAdmins, seedCatalog } from './seed.js';
import { expireUnpaidOrders } from './store.js';
import { purgeExpiredSessions } from './auth.js';

await migrate();
if (await seedCatalog()) console.log('Seeded the sample catalogue');
await ensureAdmins();

async function housekeeping() {
  try {
    const n = await expireUnpaidOrders();
    if (n) console.log(`Released stock from ${n} unpaid order(s)`);
    await purgeExpiredSessions();
  } catch (err) {
    console.error('Housekeeping failed:', err.message);
  }
}
housekeeping();
setInterval(housekeeping, 5 * 60 * 1000).unref();

createApp().listen(config.port, () => {
  console.log(`Virna running at http://localhost:${config.port}`);
  console.log(`Database: ${usingTurso ? 'Turso (hosted)' : config.dbPath}`);
  if (config.isProd && !usingTurso) console.warn('WARNING: production without TURSO_DATABASE_URL — data is stored on the server disk and may be lost on restart.');
  console.log(`Payments: ${config.razorpayReady ? 'Razorpay' : config.simulatePayments ? 'simulated (no Razorpay keys set)' : 'cash on delivery only'}`);
  console.log(`Google sign-in: ${config.googleClientId ? 'on' : 'off (GOOGLE_CLIENT_ID not set)'}`);
});
