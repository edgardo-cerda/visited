/** Estado global de la web: sesión, catálogo, mapas y registros del usuario. */
import { api, getSession, setSession, handleUnauthorized } from './api.js';
import { computeProgress } from './shared/progress.js';
import { norm } from './html.js';
import { url } from './config.js';
import { loadImageData } from './png.js';

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
function emit(evt, data) {
  for (const fn of listeners.get(evt) || []) fn(data);
}

export const store = {
  session: getSession(),
  catalog: null,
  logs: new Map(),
};

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------
export async function loadCatalog() {
  const raw = await (await fetch(url('/data/catalog.json'))).json();
  const regionByCode = new Map(raw.regions.map((r) => [r.code, r]));
  const comunaByCode = new Map(raw.comunas.map((c) => [c.code, c]));
  const comunasByRegion = new Map(raw.regions.map((r) => [r.code, raw.comunas.filter((c) => c.region === r.code)]));
  const searchIndex = [
    ...raw.regions.map((r) => ({ type: 'region', code: r.code, label: r.name, sub: `Región ${r.roman}`, key: norm(`${r.name} ${r.shortName} region ${r.roman}`) })),
    ...raw.comunas.map((c) => ({ type: 'comuna', code: c.code, label: c.name, sub: regionByCode.get(c.region).shortName, key: norm(c.name) })),
  ];
  store.catalog = { ...raw, regionByCode, comunaByCode, comunasByRegion, searchIndex };
  return store.catalog;
}

export function searchPlaces(q, limit = 8) {
  const k = norm(q);
  if (!k) return [];
  const starts = [], contains = [];
  for (const it of store.catalog.searchIndex) {
    const i = it.key.indexOf(k);
    if (i === 0 || it.key.includes(` ${k}`)) starts.push(it);
    else if (i > 0) contains.push(it);
  }
  return [...starts, ...contains].slice(0, limit);
}

export const placeName = (type, code) =>
  type === 'region' ? store.catalog.regionByCode.get(code)?.name : store.catalog.comunaByCode.get(code)?.name;

export const placeUrl = (type, code) => `/${type}/${code}`;

// ---------------------------------------------------------------------------
// Mapas pixel art (grillas RLE generadas por scripts/build-geo.mjs)
// ---------------------------------------------------------------------------
let mapsRaw = null;
const decoded = new Map();

const art = new Map();
let posterOcean = null;

/**
 * Carga las grillas (qué comuna hay en cada pixel) y el arte de cada mapa
 * (public/img/maps/<id>.png, editable). Ver docs/ARTE.md.
 */
export async function loadMaps() {
  mapsRaw = await (await fetch(url('/data/maps.json'))).json();
  await Promise.all([
    ...Object.entries(mapsRaw.maps).map(async ([id, m]) => {
      art.set(id, (await loadImageData(url(`/img/maps/${id}.png`), { width: m.w, height: m.h })).data);
    }),
    loadImageData(url('/img/poster-ocean.png')).then((img) => { posterOcean = img; }),
  ]);
}

export function getMap(id) {
  if (decoded.has(id)) return decoded.get(id);
  const m = mapsRaw.maps[id];
  if (!m) return null;
  const data = new Uint16Array(m.w * m.h);
  let i = 0;
  for (let k = 0; k < m.rle.length; k += 2) {
    data.fill(m.rle[k], i, i + m.rle[k + 1]);
    i += m.rle[k + 1];
  }
  const { first } = mapsRaw.special;
  const codes = mapsRaw.codes;
  // Para cada celda: código de comuna (o 0) y región (o 0).
  const comuna = new Int32Array(m.w * m.h);
  const region = new Int32Array(m.w * m.h);
  const regionOf = new Map(store.catalog.comunas.map((c) => [c.code, c.region]));
  for (let j = 0; j < data.length; j++) {
    const v = data[j];
    if (v >= first) {
      comuna[j] = codes[v - first];
      region[j] = regionOf.get(comuna[j]) || 0;
    }
  }
  const map = { id, ...m, rle: undefined, data, comuna, region, special: mapsRaw.special, art: art.get(id) };
  decoded.set(id, map);
  return map;
}

/** Fondo de mar (ImageData) para las imágenes de cada lugar. */
export const getPosterOcean = () => posterOcean;

/** Bbox y cantidad de celdas de cada comuna/región en un mapa (para siluetas). */
export function mapIndex(map) {
  if (map.index) return map.index;
  const inInset = (x, y) => map.insets.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const comunas = new Map(), regions = new Map();
  const grow = (idx, key, x, y) => {
    let b = idx.get(key);
    if (!b) idx.set(key, (b = { x0: x, y0: y, x1: x, y1: y, n: 0 }));
    b.n++;
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const j = y * map.w + x;
    if (!map.comuna[j]) continue;
    grow(comunas, map.comuna[j], x, y);
    if (!inInset(x, y)) grow(regions, map.region[j], x, y);
  }
  map.index = { comunas, regions };
  return map.index;
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------
export const me = () => store.session?.user || null;

function setLogs(list) {
  store.logs = new Map(list.map((l) => [logKey(l.type, l.code), l]));
  emit('logs');
}

function clearSession() {
  store.session = null;
  setSession(null);
  store.logs = new Map();
  emit('session');
  emit('logs');
}

handleUnauthorized(clearSession);

export async function refreshMe() {
  if (!store.session?.token) return;
  try {
    const [{ user }, { logs }] = await Promise.all([api('/me'), api('/me/logs')]);
    store.session = { ...store.session, user };
    setSession(store.session);
    setLogs(logs);
    emit('session');
  } catch (e) {
    if (e.status === 401) clearSession();
    else throw e;
  }
}

async function startSession(r) {
  store.session = { token: r.token, user: r.user };
  setSession(store.session);
  await refreshMe();
}

export async function login(loginName, password) {
  await startSession(await api('/auth/login', { method: 'POST', body: { login: loginName, password } }));
}

export async function register(data) {
  await startSession(await api('/auth/register', { method: 'POST', body: data }));
}

export async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* da igual */ }
  clearSession();
}

export function updateUser(user) {
  store.session = { ...store.session, user };
  setSession(store.session);
  emit('session');
}

export function forgetSession() { clearSession(); }

// ---------------------------------------------------------------------------
// Registros (visitas, notas, reseñas)
// ---------------------------------------------------------------------------
export const logKey = (type, code) => `${type}:${code}`;
export const getLog = (type, code) => store.logs.get(logKey(type, code)) || null;
export const logsToMap = (list) => new Map(list.map((l) => [logKey(l.type, l.code), l]));

/** Estado de un lugar en un mapa de registros: 'visited' | 'wishlist' | null */
export function stateIn(logs, type, code) {
  const l = logs.get(logKey(type, code));
  if (!l) return null;
  if (l.visited) return 'visited';
  if (l.wishlist) return 'wishlist';
  return null;
}

export const myProgress = () => computeProgress(store.catalog, [...store.logs.values()]);

/** Guarda cambios de un registro y devuelve el progreso antes/después. */
// Los cambios a un mismo lugar se envían en orden (p. ej. varios clics rápidos en las estrellas).
const pending = new Map();

export function saveLog(type, code, patch) {
  const key = logKey(type, code);
  const run = async () => {
    const before = myProgress();
    const { log } = await api(`/me/logs/${type}/${code}`, { method: 'PUT', body: patch });
    if (log) store.logs.set(key, log);
    else store.logs.delete(key);
    const after = myProgress();
    emit('logs', { type, code, log });
    return { log, before, after };
  };
  const p = (pending.get(key) || Promise.resolve()).catch(() => {}).then(run);
  pending.set(key, p);
  p.finally(() => { if (pending.get(key) === p) pending.delete(key); }).catch(() => {});
  return p;
}

export async function saveBatch(items) {
  const before = myProgress();
  const { logs } = await api('/me/logs/batch', { method: 'POST', body: { items } });
  setLogs(logs);
  return { before, after: myProgress() };
}
