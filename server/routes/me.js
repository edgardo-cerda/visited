import { Router } from 'express';
import { hashToken, requireAuth } from '../auth.js';
import * as catalog from '../catalog.js';
import { tx } from '../db.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import * as v from '../lib/validate.js';
import * as ser from '../serialize.js';
import { computeProgress } from '../../public/js/shared/progress.js';

export function loadLogs(db, userId, type) {
  const rows = type
    ? db.prepare('SELECT * FROM logs WHERE user_id = ? AND place_type = ? ORDER BY updated_at DESC').all(userId, type)
    : db.prepare('SELECT * FROM logs WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  return rows.map(ser.log);
}

export const progressFor = (db, userId) => computeProgress(catalog, loadLogs(db, userId));

function placeParams(req) {
  const { type, code } = req.params;
  if (!catalog.PLACE_TYPES.includes(type)) throw badRequest('El tipo debe ser "region" o "comuna".');
  const place = catalog.findPlace(type, code);
  if (!place) throw notFound('Lugar no encontrado.');
  return { type, code: place.code };
}

export function meRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  r.get('/', (req, res) => res.json({ user: ser.privateUser(req.user) }));

  r.patch('/', (req, res) => {
    const displayName = v.str(req.body, 'displayName', { min: 1, max: 40 });
    const bio = v.str(req.body, 'bio', { max: 500 });
    if (displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.user.id);
    if (bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: ser.privateUser(user) });
  });

  r.post('/password', async (req, res) => {
    const current = v.str(req.body, 'currentPassword', { required: true, max: 200, trim: false });
    const next = v.password(req.body, 'newPassword');
    const { password_hash: hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(current, hash))) throw unauthorized('La contraseña actual no es correcta.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), req.user.id);
    // Cierra las demás sesiones.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, hashToken(req.token));
    res.status(204).end();
  });

  r.delete('/', async (req, res) => {
    const password = v.str(req.body, 'password', { required: true, max: 200, trim: false });
    const { password_hash: hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(password, hash))) throw unauthorized('Contraseña incorrecta.');
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    res.status(204).end();
  });

  r.get('/progress', (req, res) => res.json(progressFor(db, req.user.id)));

  r.get('/logs', (req, res) => {
    const type = req.query.type;
    if (type && !catalog.PLACE_TYPES.includes(type)) throw badRequest('El tipo debe ser "region" o "comuna".');
    res.json({ logs: loadLogs(db, req.user.id, type) });
  });

  r.get('/logs/:type/:code', (req, res) => {
    const { type, code } = placeParams(req);
    const row = db.prepare('SELECT * FROM logs WHERE user_id = ? AND place_type = ? AND place_code = ?').get(req.user.id, type, code);
    res.json({ log: row ? ser.log(row) : null });
  });

  /**
   * Crea o actualiza el registro de un lugar. Todos los campos son opcionales;
   * los que no se envían se mantienen. Reglas:
   *  - Poner nota, reseña, fecha o "me gusta" marca el lugar como visitado.
   *  - visited:false borra nota, reseña, fecha y "me gusta".
   *  - "Quiero ir" (wishlist) sólo aplica a lugares no visitados.
   *  - Si nada queda marcado, el registro se elimina.
   */
  r.put('/logs/:type/:code', (req, res) => {
    const { type, code } = placeParams(req);
    if (req.body === undefined || typeof req.body !== 'object' || Array.isArray(req.body)) throw badRequest('Cuerpo JSON inválido.');
    const input = {
      visited: v.bool(req.body, 'visited'),
      wishlist: v.bool(req.body, 'wishlist'),
      liked: v.bool(req.body, 'liked'),
      rating: v.rating(req.body),
      review: v.str(req.body, 'review', { max: 5000 }),
      visitedOn: v.isoDate(req.body, 'visitedOn'),
    };
    if (req.body.review === null) input.review = null;

    const result = tx(db, () => {
      const prev = db.prepare('SELECT * FROM logs WHERE user_id = ? AND place_type = ? AND place_code = ?').get(req.user.id, type, code);
      const cur = prev
        ? { visited: !!prev.visited, wishlist: !!prev.wishlist, liked: !!prev.liked, rating: prev.rating, review: prev.review, visitedOn: prev.visited_on }
        : { visited: false, wishlist: false, liked: false, rating: null, review: null, visitedOn: null };
      const next = { ...cur };
      for (const [k, val] of Object.entries(input)) if (val !== undefined) next[k] = val;
      if (next.review === '') next.review = null;

      if (input.visited === false) {
        Object.assign(next, { liked: false, rating: null, review: null, visitedOn: null });
      } else if (next.rating || next.review || next.liked || next.visitedOn) {
        next.visited = true;
      }
      if (next.visited && input.wishlist === true) {
        throw conflict('Ya marcaste este lugar como visitado; no puede estar en "Quiero ir".');
      }
      if (next.visited) next.wishlist = false;

      if (!next.visited && !next.wishlist) {
        if (prev) db.prepare('DELETE FROM logs WHERE id = ?').run(prev.id);
        return null;
      }
      const now = new Date().toISOString();
      const reviewAt = next.review ? (prev && prev.review === next.review ? prev.review_at : now) : null;
      db.prepare(`
        INSERT INTO logs (user_id, place_type, place_code, visited, wishlist, liked, rating, review, visited_on, review_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, place_type, place_code) DO UPDATE SET
          visited = excluded.visited, wishlist = excluded.wishlist, liked = excluded.liked,
          rating = excluded.rating, review = excluded.review, visited_on = excluded.visited_on,
          review_at = excluded.review_at, updated_at = excluded.updated_at
      `).run(req.user.id, type, code, +next.visited, +next.wishlist, +next.liked, next.rating, next.review, next.visitedOn, reviewAt, now, now);
      return db.prepare('SELECT * FROM logs WHERE user_id = ? AND place_type = ? AND place_code = ?').get(req.user.id, type, code);
    });
    res.json({ log: result ? ser.log(result) : null });
  });

  r.delete('/logs/:type/:code', (req, res) => {
    const { type, code } = placeParams(req);
    db.prepare('DELETE FROM logs WHERE user_id = ? AND place_type = ? AND place_code = ?').run(req.user.id, type, code);
    res.status(204).end();
  });

  /** Marca/desmarca varios lugares de una vez: { items: [{type, code, visited}] } */
  r.post('/logs/batch', (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 400) throw badRequest('"items" debe ser una lista de 1 a 400 elementos.');
    const parsed = items.map((it, i) => {
      if (!catalog.PLACE_TYPES.includes(it?.type)) throw badRequest(`items[${i}].type inválido.`);
      const place = catalog.findPlace(it.type, it.code);
      if (!place) throw badRequest(`items[${i}].code no existe.`);
      if (typeof it.visited !== 'boolean') throw badRequest(`items[${i}].visited debe ser true o false.`);
      return { type: it.type, code: place.code, visited: it.visited };
    });
    tx(db, () => {
      const now = new Date().toISOString();
      const up = db.prepare(`
        INSERT INTO logs (user_id, place_type, place_code, visited, wishlist, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)
        ON CONFLICT (user_id, place_type, place_code) DO UPDATE SET visited = 1, wishlist = 0, updated_at = excluded.updated_at
        WHERE visited = 0`);
      const down = db.prepare(`
        UPDATE logs SET visited = 0, liked = 0, rating = NULL, review = NULL, visited_on = NULL, review_at = NULL, updated_at = ?
        WHERE user_id = ? AND place_type = ? AND place_code = ?`);
      const purge = db.prepare('DELETE FROM logs WHERE user_id = ? AND visited = 0 AND wishlist = 0');
      for (const it of parsed) {
        if (it.visited) up.run(req.user.id, it.type, it.code, now, now);
        else down.run(now, req.user.id, it.type, it.code);
      }
      purge.run(req.user.id);
    });
    res.json({ logs: loadLogs(db, req.user.id) });
  });

  return r;
}
