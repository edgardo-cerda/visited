import { Router } from 'express';
import * as catalog from '../catalog.js';
import { badRequest, notFound } from '../lib/errors.js';
import * as v from '../lib/validate.js';
import * as ser from '../serialize.js';
import { loadLogs, progressFor } from './me.js';

const REVIEW_SELECT = `
  SELECT l.*, u.username, u.display_name FROM logs l JOIN users u ON u.id = l.user_id`;

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
        SUM(visited) AS visitors, SUM(wishlist) AS wishlisted, SUM(liked) AS likes,
        COUNT(rating) AS ratings, AVG(rating) AS avg,
        SUM(rating = 1) AS r1, SUM(rating = 2) AS r2, SUM(rating = 3) AS r3, SUM(rating = 4) AS r4, SUM(rating = 5) AS r5,
        COUNT(review) AS reviews
      FROM logs WHERE place_type = ? AND place_code = ?`).get(type, code);
    return {
      visitors: s.visitors || 0,
      wishlisted: s.wishlisted || 0,
      likes: s.likes || 0,
      reviews: s.reviews || 0,
      ratings: s.ratings || 0,
      averageRating: s.avg ? Math.round(s.avg * 100) / 100 : null,
      histogram: [s.r1 || 0, s.r2 || 0, s.r3 || 0, s.r4 || 0, s.r5 || 0],
    };
  }

  r.get('/places/:type/:code', (req, res) => {
    const { type, code, place } = placeParams(req);
    const reviews = db.prepare(`${REVIEW_SELECT}
      WHERE l.place_type = ? AND l.place_code = ? AND l.review IS NOT NULL
      ORDER BY l.review_at DESC LIMIT 10`).all(type, code).map(ser.review);
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
      ORDER BY l.review_at DESC LIMIT ? OFFSET ?`).all(type, code, limit, offset).map(ser.review);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM logs WHERE place_type = ? AND place_code = ? AND review IS NOT NULL').get(type, code);
    res.json({ reviews, total: n, limit, offset });
  });

  /** Estadísticas agregadas de todos los lugares con actividad (para rankings). */
  r.get('/stats/places', (req, res) => {
    const type = req.query.type || 'comuna';
    if (!catalog.PLACE_TYPES.includes(type)) throw badRequest('El tipo debe ser "region" o "comuna".');
    const rows = db.prepare(`
      SELECT place_code AS code, SUM(visited) AS visitors, SUM(wishlist) AS wishlisted, SUM(liked) AS likes,
             COUNT(rating) AS ratings, AVG(rating) AS avg, COUNT(review) AS reviews
      FROM logs WHERE place_type = ? GROUP BY place_code`).all(type);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      type,
      places: rows.map((x) => ({
        code: x.code, visitors: x.visitors || 0, wishlisted: x.wishlisted || 0, likes: x.likes || 0,
        ratings: x.ratings, reviews: x.reviews, averageRating: x.avg ? Math.round(x.avg * 100) / 100 : null,
      })),
    });
  });

  // ---- Reseñas recientes (feed global) ----------------------------------------
  r.get('/reviews', (req, res) => {
    const { limit, offset } = v.pagination(req.query);
    const type = req.query.type;
    if (type && !catalog.PLACE_TYPES.includes(type)) throw badRequest('El tipo debe ser "region" o "comuna".');
    const rows = type
      ? db.prepare(`${REVIEW_SELECT} WHERE l.review IS NOT NULL AND l.place_type = ? ORDER BY l.review_at DESC LIMIT ? OFFSET ?`).all(type, limit, offset)
      : db.prepare(`${REVIEW_SELECT} WHERE l.review IS NOT NULL ORDER BY l.review_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
    res.json({ reviews: rows.map(ser.review), limit, offset });
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
    const rows = db.prepare(`${REVIEW_SELECT} WHERE l.user_id = ? AND l.review IS NOT NULL ORDER BY l.review_at DESC LIMIT ? OFFSET ?`)
      .all(u.id, limit, offset);
    res.json({ reviews: rows.map(ser.review), limit, offset });
  });

  return r;
}
