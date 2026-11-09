import crypto from 'node:crypto';
import { config } from './config.js';
import { unauthorized, tooMany } from './lib/errors.js';

export const hashToken = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Crea una sesión y devuelve el token en claro (sólo se guarda su hash). */
export function createSession(db, userId, client) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.tokenTtlDays * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, client, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token), userId, client ? String(client).slice(0, 200) : null, expires,
  );
  return { token, expiresAt: expires };
}

export function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function bearer(req) {
  const h = req.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Middleware: si hay un token válido, deja el usuario en req.user. */
export function authenticate(db) {
  const find = db.prepare(`
    SELECT u.id, u.username, u.email, u.display_name, u.bio, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`);
  let lastPurge = 0;
  return (req, _res, next) => {
    // Limpieza ocasional de sesiones expiradas.
    if (Date.now() - lastPurge > 36e5) {
      lastPurge = Date.now();
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    }
    const token = bearer(req);
    if (token) {
      const u = find.get(hashToken(token), new Date().toISOString());
      if (u) {
        req.user = u;
        req.token = token;
      }
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Limitador simple en memoria por IP (ventana fija). */
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip;
    let e = hits.get(key);
    if (!e || now > e.reset) {
      e = { n: 0, reset: now + windowMs };
      hits.set(key, e);
      if (hits.size > 10000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    if (++e.n > max) return next(tooMany());
    next();
  };
}
