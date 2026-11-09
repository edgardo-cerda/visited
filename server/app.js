import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { authenticate } from './auth.js';
import { ApiError, notFound } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { publicRoutes } from './routes/public.js';

export function createApp(db, opts = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', opts.trustProxy ?? config.trustProxy);

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });

  // ---- API (JSON, pensada también para apps móviles) -------------------------
  const api = express.Router();
  const origins = opts.corsOrigins ?? config.corsOrigins;
  api.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && (origins.includes('*') || origins.includes(origin))) {
      res.set({
        'Access-Control-Allow-Origin': origins.includes('*') ? '*' : origin,
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      });
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  api.use(express.json({ limit: '100kb' }));
  api.use(authenticate(db));
  api.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use('/auth', authRoutes(db));
  api.use('/me', meRoutes(db));
  api.use('/', publicRoutes(db));
  api.use((_req, _res, next) => next(notFound('Ruta de API no encontrada.')));
  api.use((err, _req, res, _next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details || {}) } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_request', message: 'JSON inválido.' } });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'too_large', message: 'El cuerpo de la petición es demasiado grande.' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Error interno del servidor.' } });
  });
  app.use('/api/v1', api);

  // ---- Web (SPA estática) ------------------------------------------------------
  const pub = path.join(ROOT, 'public');
  app.use(express.static(pub, {
    setHeaders: (res, file) => {
      if (file.includes(`${path.sep}data${path.sep}`)) res.set('Cache-Control', 'public, max-age=86400');
    },
  }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(pub, 'index.html')));

  return app;
}
