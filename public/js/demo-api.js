/**
 * "Servidor" local para la versión de prueba (GitHub Pages): implementa las
 * mismas rutas y reglas que la API real (server/routes/*), pero guarda todo en
 * localStorage. Cada navegador tiene sus propias cuentas y datos.
 */
import { url } from './config.js';
import { computeProgress } from './shared/progress.js';

const KEY = 'visited.demo.db';

let catalogPromise = null;
function catalog() {
  catalogPromise ||= fetch(url('/data/catalog.json')).then((r) => r.json()).then((c) => ({
    ...c,
    regionByCode: new Map(c.regions.map((r) => [r.code, r])),
    comunaByCode: new Map(c.comunas.map((x) => [x.code, x])),
  }));
  return catalogPromise;
}

function load() {
  try {
    const db = JSON.parse(localStorage.getItem(KEY));
    if (db && db.users && db.logs) {
      db.votes ||= [];
      // Datos de la versión anterior: sin "me gusta" en lugares.
      for (const l of db.logs) delete l.liked;
      // Visitar una comuna marca su región.
      for (const u of db.users) syncRegions(db, u.id);
      return db;
    }
  } catch { /* datos corruptos: se reinicia */ }
  return { users: [], sessions: {}, logs: [], votes: [], nextId: 1 };
}
const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));

/**
 * Regla: si visitaste alguna comuna de una región, la región queda visitada
 * (código de región = código de comuna / 1000). Devuelve las regiones marcadas.
 */
function syncRegions(db, userId) {
  const regions = new Set(db.logs.filter((l) => l.userId === userId && l.type === 'comuna' && l.visited).map((l) => Math.floor(l.code / 1000)));
  const changed = [];
  for (const code of regions) {
    let r = db.logs.find((l) => l.userId === userId && l.type === 'region' && l.code === code);
    if (r?.visited) continue;
    const t = new Date().toISOString();
    if (!r) db.logs.push((r = { id: db.nextId++, userId, type: 'region', code, rating: null, review: null, visitedOn: null, reviewAt: null, createdAt: t }));
    Object.assign(r, { visited: true, wishlist: false, updatedAt: t });
    changed.push(r);
  }
  return changed;
}

/** Cuántas comunas visitadas tiene el usuario en una región. */
const comunasVisitedIn = (db, userId, region) =>
  db.logs.filter((l) => l.userId === userId && l.type === 'comuna' && l.visited && Math.floor(l.code / 1000) === region).length;

class Fail extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.status = status;
    this.body = { error: { code, message, ...(field ? { field } : {}) } };
  }
}
const bad = (m, field) => new Fail(400, 'bad_request', m, field);
const unauthorized = (m = 'Debes iniciar sesión.') => new Fail(401, 'unauthorized', m);
const notFound = (m = 'No encontrado.') => new Fail(404, 'not_found', m);
const conflict = (m, field) => new Fail(409, 'conflict', m, field);
const forbidden = (m) => new Fail(403, 'forbidden', m);

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const hashPassword = async (pw, salt) => sha256(`${salt}:${pw.normalize('NFKC')}`);
const now = () => new Date().toISOString();
const lc = (s) => String(s).toLowerCase();

// ---- Validación (mismas reglas que server/lib/validate.js) ------------------
function str(body, key, { required = false, min = 0, max = 200, trim = true } = {}) {
  let v = body?.[key];
  if (v === undefined || v === null) {
    if (required) throw bad(`Falta el campo "${key}".`, key);
    return undefined;
  }
  if (typeof v !== 'string') throw bad(`"${key}" debe ser texto.`, key);
  if (trim) v = v.trim();
  if (v.length < min) throw bad(`"${key}" debe tener al menos ${min} caracteres.`, key);
  if (v.length > max) throw bad(`"${key}" puede tener como máximo ${max} caracteres.`, key);
  return v;
}
function password(body, key = 'password') {
  const v = str(body, key, { required: true, max: 200, trim: false });
  if (v.length < 8) throw bad('La contraseña debe tener al menos 8 caracteres.', key);
  return v;
}
function bool(body, key) {
  const v = body?.[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw bad(`"${key}" debe ser true o false.`, key);
  return v;
}
function ratingOf(body) {
  const v = body?.rating;
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v * 2) || v < 0.5 || v > 5) throw bad('La evaluación debe ir de 0.5 a 5, en pasos de media estrella.', 'rating');
  return v;
}
function isoDate(body, key) {
  const v = body?.[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`"${key}" debe tener formato AAAA-MM-DD.`, key);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`"${key}" no es una fecha válida.`, key);
  if (v < '1900-01-01' || d.getTime() > Date.now() + 864e5) throw bad(`"${key}" no puede ser una fecha futura.`, key);
  return v;
}
function page(q) {
  return {
    limit: Math.min(100, Math.max(1, parseInt(q.get('limit'), 10) || 20)),
    offset: Math.max(0, parseInt(q.get('offset'), 10) || 0),
  };
}

// ---- Serialización ----------------------------------------------------------
const publicUser = (u) => ({ username: u.username, displayName: u.displayName, bio: u.bio, createdAt: u.createdAt });
const privateUser = (u) => ({ ...publicUser(u), email: u.email });
const pubLog = (l) => ({
  type: l.type, code: l.code, visited: l.visited, wishlist: l.wishlist, rating: l.rating,
  review: l.review, visitedOn: l.visitedOn, reviewAt: l.reviewAt, createdAt: l.createdAt, updatedAt: l.updatedAt,
});

function placeSummary(cat, type, code) {
  if (type === 'region') {
    const r = cat.regionByCode.get(code);
    return { type, code, name: r.name, shortName: r.shortName, roman: r.roman };
  }
  const c = cat.comunaByCode.get(code);
  const r = cat.regionByCode.get(c.region);
  return { type, code, name: c.name, province: c.province, region: { code: r.code, name: r.name, shortName: r.shortName, roman: r.roman } };
}

function reviewOf(db, cat, l, me) {
  const u = db.users.find((x) => x.id === l.userId);
  const vs = db.votes.filter((v) => v.logId === l.id);
  const up = vs.filter((v) => v.value === 1).length, down = vs.filter((v) => v.value === -1).length;
  return {
    id: l.id, user: { username: u.username, displayName: u.displayName }, place: placeSummary(cat, l.type, l.code),
    rating: l.rating, review: l.review, visitedOn: l.visitedOn, reviewAt: l.reviewAt || l.updatedAt,
    votes: { up, down, score: up - down },
    myVote: me ? vs.find((v) => v.userId === me.id)?.value || 0 : 0,
  };
}
const byRecent = (a, b) => (b.reviewAt || '').localeCompare(a.reviewAt || '') || b.id - a.id;
const byTop = (a, b) => b.votes.score - a.votes.score || byRecent(a, b);
function sorter(q, def = 'top') {
  const s = q.get('sort') || def;
  if (s !== 'top' && s !== 'recent') throw bad('"sort" debe ser "top" o "recent".');
  return s === 'top' ? byTop : byRecent;
}
/** Borra votos de reseñas que ya no existen. */
function pruneVotes(db) {
  const alive = new Set(db.logs.filter((l) => l.review).map((l) => l.id));
  const users = new Set(db.users.map((u) => u.id));
  db.votes = db.votes.filter((v) => alive.has(v.logId) && users.has(v.userId));
}

function placeOf(cat, type, code) {
  if (type !== 'region' && type !== 'comuna') throw bad('El tipo debe ser "region" o "comuna".');
  const n = Number(code);
  const p = type === 'region' ? cat.regionByCode.get(n) : cat.comunaByCode.get(n);
  if (!p) throw notFound('Lugar no encontrado.');
  return p;
}

function userLogs(db, userId, type) {
  return db.logs
    .filter((l) => l.userId === userId && (!type || l.type === type))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(pubLog);
}

// ---- Rutas ------------------------------------------------------------------
async function handle(method, path, body, token) {
  const cat = await catalog();
  const db = load();
  const [pathname, qs] = path.split('?');
  const q = new URLSearchParams(qs || '');
  const parts = pathname.split('/').filter(Boolean);
  const session = token ? db.sessions[await sha256(token)] : null;
  const me = session && session.expiresAt > now() ? db.users.find((u) => u.id === session.userId) : null;
  const requireMe = () => { if (!me) throw unauthorized(); return me; };
  const findUser = (name) => {
    const u = db.users.find((x) => lc(x.username) === lc(name));
    if (!u) throw notFound('Usuario no encontrado.');
    return u;
  };
  const startSession = async (u) => {
    const tok = randomHex(32);
    const expiresAt = new Date(Date.now() + 60 * 864e5).toISOString();
    db.sessions[await sha256(tok)] = { userId: u.id, expiresAt };
    save(db);
    return { token: tok, expiresAt, user: privateUser(u) };
  };
  const R = (m, ...segs) => method === m && parts.length === segs.length && segs.every((s, i) => s === '*' || s === parts[i]);

  // Auth
  if (R('POST', 'auth', 'register')) {
    const username = str(body, 'username', { required: true, max: 20 });
    if (!/^[a-z0-9_]{3,20}$/i.test(username)) throw bad('El nombre de usuario debe tener entre 3 y 20 caracteres: letras, números o "_".', 'username');
    const email = str(body, 'email', { required: true, max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Email inválido.', 'email');
    const pw = password(body);
    const displayName = str(body, 'displayName', { max: 40 }) || username;
    if (db.users.some((u) => lc(u.username) === lc(username))) throw conflict('Ese nombre de usuario ya está en uso.', 'username');
    if (db.users.some((u) => u.email === email)) throw conflict('Ya existe una cuenta con ese email.', 'email');
    const salt = randomHex(16);
    const u = { id: db.nextId++, username, email, displayName, bio: '', salt, passwordHash: await hashPassword(pw, salt), createdAt: now() };
    db.users.push(u);
    return { status: 201, data: await startSession(u) };
  }
  if (R('POST', 'auth', 'login')) {
    const login = str(body, 'login', { required: true, max: 254 });
    const pw = str(body, 'password', { required: true, max: 200, trim: false });
    const u = db.users.find((x) => lc(x.username) === lc(login) || x.email === lc(login));
    if (!u || (await hashPassword(pw, u.salt)) !== u.passwordHash) throw unauthorized('Usuario o contraseña incorrectos.');
    return { data: await startSession(u) };
  }
  if (R('POST', 'auth', 'logout')) {
    requireMe();
    delete db.sessions[await sha256(token)];
    save(db);
    return { status: 204 };
  }

  // Mi cuenta
  if (parts[0] === 'me') {
    const u = requireMe();
    if (R('GET', 'me')) return { data: { user: privateUser(u) } };
    if (R('PATCH', 'me')) {
      const displayName = str(body, 'displayName', { min: 1, max: 40 });
      const bio = str(body, 'bio', { max: 500 });
      if (displayName !== undefined) u.displayName = displayName;
      if (bio !== undefined) u.bio = bio;
      save(db);
      return { data: { user: privateUser(u) } };
    }
    if (R('POST', 'me', 'password')) {
      const current = str(body, 'currentPassword', { required: true, max: 200, trim: false });
      const next = password(body, 'newPassword');
      if ((await hashPassword(current, u.salt)) !== u.passwordHash) throw unauthorized('La contraseña actual no es correcta.');
      u.salt = randomHex(16);
      u.passwordHash = await hashPassword(next, u.salt);
      const mine = await sha256(token);
      for (const [k, s] of Object.entries(db.sessions)) if (s.userId === u.id && k !== mine) delete db.sessions[k];
      save(db);
      return { status: 204 };
    }
    if (R('DELETE', 'me')) {
      const pw = str(body, 'password', { required: true, max: 200, trim: false });
      if ((await hashPassword(pw, u.salt)) !== u.passwordHash) throw unauthorized('Contraseña incorrecta.');
      db.users = db.users.filter((x) => x.id !== u.id);
      db.logs = db.logs.filter((l) => l.userId !== u.id);
      for (const [k, s] of Object.entries(db.sessions)) if (s.userId === u.id) delete db.sessions[k];
      pruneVotes(db);
      save(db);
      return { status: 204 };
    }
    if (R('GET', 'me', 'progress')) return { data: computeProgress(cat, userLogs(db, u.id)) };
    if (R('GET', 'me', 'logs')) return { data: { logs: userLogs(db, u.id, q.get('type')) } };
    if (R('POST', 'me', 'logs', 'batch')) {
      const items = body?.items;
      if (!Array.isArray(items) || !items.length || items.length > 400) throw bad('"items" debe ser una lista de 1 a 400 elementos.');
      for (const it of items) {
        const p = placeOf(cat, it?.type, it?.code);
        let l = db.logs.find((x) => x.userId === u.id && x.type === it.type && x.code === p.code);
        if (it.visited === true) {
          if (!l) db.logs.push((l = { id: db.nextId++, userId: u.id, type: it.type, code: p.code, visited: true, wishlist: false, rating: null, review: null, visitedOn: null, reviewAt: null, createdAt: now(), updatedAt: now() }));
          else if (!l.visited) Object.assign(l, { visited: true, wishlist: false, updatedAt: now() });
        } else if (it.visited === false) {
          if (l) Object.assign(l, { visited: false, rating: null, review: null, visitedOn: null, reviewAt: null, updatedAt: now() });
        } else throw bad('"visited" debe ser true o false.');
      }
      db.logs = db.logs.filter((l) => l.userId !== u.id || l.visited || l.wishlist);
      syncRegions(db, u.id);
      pruneVotes(db);
      save(db);
      return { data: { logs: userLogs(db, u.id) } };
    }
    if (parts[1] === 'logs' && parts.length === 4) {
      const [, , type, codeStr] = parts;
      const p = placeOf(cat, type, codeStr);
      const idx = db.logs.findIndex((x) => x.userId === u.id && x.type === type && x.code === p.code);
      const prev = idx >= 0 ? db.logs[idx] : null;
      if (method === 'GET') return { data: { log: prev ? pubLog(prev) : null } };
      const blockUnvisit = () => {
        const n = type === 'region' ? comunasVisitedIn(db, u.id, p.code) : 0;
        if (n > 0) throw conflict(`Visitaste ${n} comuna${n === 1 ? '' : 's'} de esta región, así que la región queda marcada como visitada. Desmárcala${n === 1 ? '' : 's'} primero.`);
      };
      if (method === 'DELETE') {
        blockUnvisit();
        if (prev) db.logs.splice(idx, 1);
        pruneVotes(db);
        save(db);
        return { status: 204 };
      }
      if (method === 'PUT') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('Cuerpo JSON inválido.');
        const input = {
          visited: bool(body, 'visited'), wishlist: bool(body, 'wishlist'),
          rating: ratingOf(body), review: str(body, 'review', { max: 5000 }), visitedOn: isoDate(body, 'visitedOn'),
        };
        if (body.review === null) input.review = null;
        const next = prev
          ? { visited: prev.visited, wishlist: prev.wishlist, rating: prev.rating, review: prev.review, visitedOn: prev.visitedOn }
          : { visited: false, wishlist: false, rating: null, review: null, visitedOn: null };
        for (const [k, v] of Object.entries(input)) if (v !== undefined) next[k] = v;
        if (next.review === '') next.review = null;
        if (input.visited === false) Object.assign(next, { rating: null, review: null, visitedOn: null });
        else if (next.rating || next.review || next.visitedOn) next.visited = true;
        if (next.visited && input.wishlist === true) throw conflict('Ya marcaste este lugar como visitado; no puede estar en "Quiero ir".');
        if (next.visited) next.wishlist = false;
        if (prev?.visited && !next.visited) blockUnvisit();
        if (!next.visited && !next.wishlist) {
          if (prev) db.logs.splice(idx, 1);
          pruneVotes(db);
          save(db);
          return { data: { log: null, regionLogs: [] } };
        }
        const t = now();
        const reviewAt = next.review ? (prev && prev.review === next.review ? prev.reviewAt : t) : null;
        const log = prev || { id: db.nextId++, userId: u.id, type, code: p.code, createdAt: t };
        Object.assign(log, next, { reviewAt, updatedAt: t });
        if (!prev) db.logs.push(log);
        const regionLogs = type === 'comuna' && next.visited ? syncRegions(db, u.id) : [];
        pruneVotes(db);
        save(db);
        return { data: { log: pubLog(log), regionLogs: regionLogs.map(pubLog) } };
      }
    }
  }

  // Público
  if (R('GET', 'health')) return { data: { ok: true, demo: true } };
  if (R('GET', 'catalog')) return { data: { regions: cat.regions, comunas: cat.comunas } };
  if (parts[0] === 'places' && method === 'GET' && (parts.length === 3 || (parts.length === 4 && parts[3] === 'reviews'))) {
    const [, type, codeStr] = parts;
    const p = placeOf(cat, type, codeStr);
    const ls = db.logs.filter((l) => l.type === type && l.code === p.code);
    const all = ls.filter((l) => l.review).map((l) => reviewOf(db, cat, l, me));
    const reviews = [...all].sort(parts.length === 4 ? sorter(q) : byTop);
    if (parts.length === 4) {
      const { limit, offset } = page(q);
      return { data: { reviews: reviews.slice(offset, offset + limit), total: reviews.length, limit, offset } };
    }
    const rated = ls.filter((l) => l.rating);
    const stats = {
      visitors: ls.filter((l) => l.visited).length,
      wishlisted: ls.filter((l) => l.wishlist).length,
      reviews: reviews.length,
      ratings: rated.length,
      averageRating: rated.length ? Math.round((rated.reduce((s, l) => s + l.rating, 0) / rated.length) * 100) / 100 : null,
      histogram: Array.from({ length: 10 }, (_, i) => rated.filter((l) => l.rating === (i + 1) / 2).length),
    };
    const mine = me ? ls.find((l) => l.userId === me.id) : null;
    const extra = type === 'comuna'
      ? { region: placeSummary(cat, 'region', p.region) }
      : { comunas: cat.comunas.filter((c) => c.region === p.code).map((c) => c.code) };
    return { data: { place: { type, ...p, ...extra }, stats, reviews: reviews.slice(0, 10), myLog: mine ? pubLog(mine) : null } };
  }
  if (R('GET', 'stats', 'places')) {
    const type = q.get('type') || 'comuna';
    if (type !== 'region' && type !== 'comuna') throw bad('El tipo debe ser "region" o "comuna".');
    const groups = new Map();
    for (const l of db.logs) if (l.type === type) {
      if (!groups.has(l.code)) groups.set(l.code, []);
      groups.get(l.code).push(l);
    }
    const places = [...groups].map(([code, ls]) => {
      const rated = ls.filter((l) => l.rating);
      return {
        code, visitors: ls.filter((l) => l.visited).length, wishlisted: ls.filter((l) => l.wishlist).length,
        ratings: rated.length, reviews: ls.filter((l) => l.review).length,
        averageRating: rated.length ? Math.round((rated.reduce((s, l) => s + l.rating, 0) / rated.length) * 100) / 100 : null,
      };
    });
    return { data: { type, places } };
  }
  if (R('GET', 'reviews')) {
    const { limit, offset } = page(q);
    const type = q.get('type');
    const list = db.logs.filter((l) => l.review && (!type || l.type === type)).map((l) => reviewOf(db, cat, l, me)).sort(sorter(q));
    return { data: { reviews: list.slice(offset, offset + limit), limit, offset } };
  }
  if (method === 'PUT' && parts.length === 3 && parts[0] === 'reviews' && parts[2] === 'vote') {
    const u = requireMe();
    const value = body?.value;
    if (![1, -1, 0].includes(value)) throw bad('"value" debe ser 1, -1 o 0.', 'value');
    const log = db.logs.find((l) => l.id === Number(parts[1]) && l.review);
    if (!log) throw notFound('Reseña no encontrada.');
    if (log.userId === u.id) throw forbidden('No puedes votar tu propia reseña.');
    db.votes = db.votes.filter((v) => !(v.logId === log.id && v.userId === u.id));
    if (value) db.votes.push({ logId: log.id, userId: u.id, value });
    save(db);
    return { data: { review: reviewOf(db, cat, log, u) } };
  }
  if (R('GET', 'users')) {
    const s = lc(q.get('q') || '').trim();
    if (s.length < 2) throw bad('La búsqueda debe tener al menos 2 caracteres.');
    return { data: { users: db.users.filter((u) => lc(u.username).includes(s) || lc(u.displayName).includes(s)).slice(0, 20).map(publicUser) } };
  }
  if (parts[0] === 'users' && parts.length >= 2 && method === 'GET') {
    const u = findUser(decodeURIComponent(parts[1]));
    if (parts.length === 2) {
      const p = computeProgress(cat, userLogs(db, u.id));
      return { data: { user: publicUser(u), summary: { level: p.level, regions: p.regions, comunas: p.comunas, area: p.area, counts: p.counts } } };
    }
    if (parts[2] === 'progress') return { data: computeProgress(cat, userLogs(db, u.id)) };
    if (parts[2] === 'logs') return { data: { logs: userLogs(db, u.id, q.get('type')) } };
    if (parts[2] === 'reviews') {
      const { limit, offset } = page(q);
      const list = db.logs.filter((l) => l.userId === u.id && l.review).map((l) => reviewOf(db, cat, l, me)).sort(sorter(q, 'recent'));
      return { data: { reviews: list.slice(offset, offset + limit), limit, offset } };
    }
  }
  throw notFound('Ruta de API no encontrada.');
}

/** Igual que fetch a la API real: devuelve { status, data }. */
export async function demoRequest(method, path, body, token) {
  try {
    const r = await handle(method, path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)), token);
    return { status: r.status || 200, data: r.data ?? null };
  } catch (e) {
    if (e instanceof Fail) return { status: e.status, data: e.body };
    throw e;
  }
}
