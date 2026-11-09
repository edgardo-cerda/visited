import { Router } from 'express';
import { config } from '../config.js';
import { createSession, deleteSession, rateLimit, requireAuth } from '../auth.js';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../lib/passwords.js';
import { conflict, unauthorized } from '../lib/errors.js';
import * as v from '../lib/validate.js';
import { privateUser } from '../serialize.js';

export function authRoutes(db) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60e3, max: config.authRateLimit });

  r.post('/register', limiter, async (req, res) => {
    const username = v.username(req.body);
    const email = v.email(req.body);
    const password = v.password(req.body);
    const displayName = v.str(req.body, 'displayName', { max: 40 }) || username;

    const taken = db.prepare('SELECT username = ? COLLATE NOCASE AS u, email = ? COLLATE NOCASE AS e FROM users WHERE username = ? OR email = ?')
      .all(username, email, username, email);
    if (taken.some((t) => t.u)) throw conflict('Ese nombre de usuario ya está en uso.', { field: 'username' });
    if (taken.some((t) => t.e)) throw conflict('Ya existe una cuenta con ese email.', { field: 'email' });

    const hash = await hashPassword(password);
    let user;
    try {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)')
        .run(username, email, hash, displayName);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw conflict('El usuario o email ya está en uso.');
      throw e;
    }
    const session = createSession(db, user.id, req.get('user-agent'));
    res.status(201).json({ ...session, user: privateUser(user) });
  });

  r.post('/login', limiter, async (req, res) => {
    const login = v.str(req.body, 'login', { required: true, max: 254 });
    const password = v.str(req.body, 'password', { required: true, max: 200, trim: false });
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login);
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Usuario o contraseña incorrectos.');
    const session = createSession(db, user.id, req.get('user-agent'));
    res.json({ ...session, user: privateUser(user) });
  });

  r.post('/logout', requireAuth, (req, res) => {
    deleteSession(db, req.token);
    res.status(204).end();
  });

  return r;
}
