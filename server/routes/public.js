import { Router } from 'express';
import { requireAuth } from '../auth.js';
import * as catalog from '../catalog.js';
import { ApiError, badRequest, notFound } from '../lib/errors.js';
import * as v from '../lib/validate.js';
import * as ser from '../serialize.js';
import { loadLogs, progressFor } from './me.js';

/** Reseñas con autor y votos. Parámetro 1: id del usuario actual (o -1) para my_vote. */
const REVIEW_SELECT = `
  SELECT l.*, u.username, u.display_name,
         COALESCE(v.up, 0) AS up, COALESCE(v.down, 0) AS down, mv.value AS my_vote
  FROM logs l
  JOIN users u ON u.id = l.user_id
  LEFT JOIN (SELECT log_id, SUM(value = 1) AS up, SUM(value = -1) AS down FROM review_votes GROUP BY log_id) v ON v.log_id = l.id
  LEFT JOIN review_votes mv ON mv.log_id = l.id AND mv.user_id = ?`;

/** Orden: "top" (votos netos, luego más recientes) o "recent". */
const ORDER = {
  top: 'ORDER BY (COALESCE(v.up, 0) - COALESCE(v.down, 0)) DESC, l.review_at DESC, l.id DESC',
  recent: 'ORDER BY l.review_at DESC, l.id DESC',
};
function sortOf(query, def = 'top') {
  const s = query.sort || def;
  if (!ORDER[s]) throw badRequest('"sort" debe ser "top" o "recent".');
  return ORDER[s];
}

// Notas posibles: 0.5, 1, …, 5 (10 valores) para el histograma.
const RATING_STEPS = Array.from({ length: 10 }, (_, i) => (i + 1) / 2);

export function publicRoutes(db) {
  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true }));

  r.get('/catalog', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ regions: catalog.regions, comunas: catalog.comunas });
  });

  // ---- Lugares -------------------------------------------------------------
  function placeParams(req) {
    const { type, code } = req.params;
    if (!catalog.PLACE_TYPES.includes(type)) throw badRequest('El tipo debe ser "region" o "comuna".');
    const place = catalog.findPlace(type, code);
    if (!place) throw notFound('Lugar no encontrado.');
    return { type, code: place.code, place };
  }

  function placeStats(type, code) {
    const s = db.prepare(`
      SELECT
        SUM(visited) AS visitors, SUM(wishlist) AS wishlisted,
        COUNT(rating) AS ratings, AVG(rating) AS avg, COUNT(review) AS reviews
      FROM logs WHERE place_type = ? AND place_code = ?`).get(type, code);
    const counts = new Map(db.prepare(`
      SELECT rating, COUNT(*) AS n FROM logs WHERE place_type = ? AND place_code = ? AND rating IS NOT NULL GROUP BY rating`)
      .all(type, code).map((r) => [r.rating, r.n]));
    return {
      visitors: s.visitors || 0,
      wishlisted: s.wishlisted || 0,
      reviews: s.reviews || 0,
      ratings: s.ratings || 0,
      averageRating: s.avg ? Math.round(s.avg * 100) / 100 : null,
      // Cantidad de notas 0.5, 1, 1.5, …, 5
      histogram: RATING_STEPS.map((r) => counts.get(r) || 0),
    };
  }

  r.get('/places/:type/:code', (req, res) => {
    const { type, code, place } = placeParams(req);
    const reviews = db.prepare(`${REVIEW_SELECT}
      WHERE l.place_type = ? AND l.place_code = ? AND l.review IS NOT NULL
      ${ORDER.top} LIMIT 10`).all(req.user?.id ?? -1, type, code).map(ser.review);
    let myLog = null;
    if (req.user) {
      const row = db.prepare('SELECT * FROM logs WHERE user_id = ? AND place_type = ? AND place_code = ?').get(req.user.id, type, code);
      myLog = row ? ser.log(row) : null;
    }
    const extra = type === 'comuna'
      ? { region: catalog.placeSummary('region', place.region) }
      : { comunas: catalog.comunasByRegion.get(place.code).map((c) => c.code) };
    res.json({ place: { type, ...place, ...extra }, stats: placeStats(type, code), reviews, myLog });
  });

  r.get('/places/:type/:code/reviews', (req, res) => {
    const { type, code } = placeParams(req);
    const { limit, offset } = v.pagination(req.query);
    const reviews = db.prepare(`${REVIEW_SELECT}
      WHERE l.place_type = ? AND l.place_code = ? AND l.review IS NOT NULL
      ${sortOf(req.query)} LIMIT ? OFFSET ?`).all(req.user?.id ?? -1, type, code, limit, offset).map(ser.review);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM logs WHERE place_type = ? AND place_code = ? AND review IS NOT NULL').get(type, code);
    res.json({ reviews, total: n, limit, offset });
  });

  /** Estadísticas agregadas de todos los lugares con actividad (para rankings). */
  r.get('/stats/places', (req, res) => {
    const type = req.query.type || 'comuna';
    if (!catalog.PLACE_TYPES.includes(type)) throw badRequest('El tipo debe ser "region" o "comuna".');
    const rows = db.prepare(`
      SELECT place_code AS code, SUM(visited) AS visitors, SUM(wishlist) AS wishlisted,
             COUNT(rating) AS ratings, AVG(rating) AS avg, COUNT(review) AS reviews
      FROM logs WHERE place_type = ? GROUP BY place_code`).all(type);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      type,
      places: rows.map((x) => ({
        code: x.code, visitors: x.visitors || 0, wishlisted: x.wishlisted || 0,
        ratings: x.ratings, reviews: x.reviews, averageRating: x.avg ? Math.round(x.avg * 100) / 100 : null,
      })),
    });
  });

  // ---- Reseñas (feed global y votos) ------------------------------------------
  r.get('/reviews', (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    const type = req.query.type;
    if (type && !catalog.PLACE_TYPES.includes(type)) throw badRequest('El tipo debe ser "region" o "comuna".');
    const order = sortOf(req.query);
    const me = req.user?.id ?? -1;
    const rows = type
      ? db.prepare(`${REVIEW_SELECT} WHERE l.review IS NOT NULL AND l.place_type = ? ${order} LIMIT ? OFFSET ?`).all(me, type, limit, offset)
      : db.prepare(`${REVIEW_SELECT} WHERE l.review IS NOT NULL ${order} LIMIT ? OFFSET ?`).all(me, limit, offset);
    res.json({ reviews: rows.map(ser.review), limit, offset });
  });

  /** Vota una reseña: { value: 1 } me gusta, { value: -1 } no me gusta, { value: 0 } quita el voto. */
  r.put('/reviews/:id/vote', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const value = req.body?.value;
    if (![1, -1, 0].includes(value)) throw badRequest('"value" debe ser 1, -1 o 0.', { field: 'value' });
    const log = Number.isInteger(id) ? db.prepare('SELECT id, user_id FROM logs WHERE id = ? AND review IS NOT NULL').get(id) : null;
    if (!log) throw notFound('Reseña no encontrada.');
    if (log.user_id === req.user.id) throw new ApiError(403, 'forbidden', 'No puedes votar tu propia reseña.');
    if (value === 0) db.prepare('DELETE FROM review_votes WHERE log_id = ? AND user_id = ?').run(id, req.user.id);
    else {
      db.prepare(`INSERT INTO review_votes (log_id, user_id, value) VALUES (?, ?, ?)
        ON CONFLICT (log_id, user_id) DO UPDATE SET value = excluded.value`).run(id, req.user.id, value);
    }
    const row = db.prepare(`${REVIEW_SELECT} WHERE l.id = ?`).get(req.user.id, id);
    res.json({ review: ser.review(row) });
  });

  // ---- Usuarios (perfiles públicos) --------------------------------------------
  function findUser(req) {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.params.username));
    if (!u) throw notFound('Usuario no encontrado.');
    return u;
  }

  r.get('/users', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) throw badRequest('La búsqueda debe tener al menos 2 caracteres.');
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const users = db.prepare(`SELECT * FROM users WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' ORDER BY username LIMIT 20`)
      .all(like, like).map(ser.publicUser);
    res.json({ users });
  });

  r.get('/users/:username', (req, res) => {
    const u = findUser(req);
    const p = progressFor(db, u.id);
    res.json({
      user: ser.publicUser(u),
      summary: { level: p.level, regions: p.regions, comunas: p.comunas, area: p.area, counts: p.counts },
    });
  });

  r.get('/users/:username/progress', (req, res) => res.json(progressFor(db, findUser(req).id)));

  r.get('/users/:username/logs', (req, res) => {
    const type = req.query.type;
    if (type && !catalog.PLACE_TYPES.includes(type)) throw badRequest('El tipo debe ser "region" o "comuna".');
    res.json({ logs: loadLogs(db, findUser(req).id, type) });
  });

  r.get('/users/:username/reviews', (req, res) => {
    const u = findUser(req);
    const { limit, offset } = v.pagination(req.query);
    const rows = db.prepare(`${REVIEW_SELECT} WHERE l.user_id = ? AND l.review IS NOT NULL ${sortOf(req.query, 'recent')} LIMIT ? OFFSET ?`)
      .all(req.user?.id ?? -1, u.id, limit, offset);
    res.json({ reviews: rows.map(ser.review), limit, offset });
  });

  return r;
}
