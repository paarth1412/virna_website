import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { loadUser } from './auth.js';
import { authRouter, accountRouter } from './routes/auth.js';
import { shopRouter } from './routes/shop.js';
import { ordersRouter, webhookRouter } from './routes/orders.js';
import { adminRouter } from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN'
    });
    next();
  });

  // Webhooks need the raw body for signature checks, so they go before the JSON parser.
  app.use('/api/webhooks', webhookRouter);
  app.use(express.json({ limit: '100kb' }));

  // Cross-site forms cannot send application/json without a CORS preflight,
  // so requiring it on writes (plus SameSite cookies) blocks CSRF.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Send requests as JSON' });
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.use(loadUser);
  app.use('/api', shopRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));

  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !err.expose ? 'Something went wrong on our side. Please try again.' : err.message });
  });
  return app;
}
