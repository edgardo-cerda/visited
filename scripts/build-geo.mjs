#!/usr/bin/env node
/**
 * Genera los datos geográficos de la app a partir de fuentes abiertas:
 *
 *   - Límites comunales de Chile (Biblioteca del Congreso Nacional, vía
 *     github.com/caracena/chile-geojson, commit fijado más abajo).
 *   - Natural Earth 1:50m land (dominio público) para dibujar la Antártica.
 *
 * Salidas (se versionan en el repo, no hace falta correr esto para usar la app):
 *   public/data/catalog.json  -> regiones y comunas (códigos CUT, nombres, superficies)
 *   public/data/maps.json     -> grillas de "pixeles" (RLE) para el mapa pixel art
 *
 * Uso:  node scripts/build-geo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'geo');
const OUT = path.join(ROOT, 'public', 'data');

const COMUNAS_COMMIT = '92332f85d52030e9f549784b7d9c6fdb87b2dd2c';
const COMUNAS_URL = (n) =>
  `https://raw.githubusercontent.com/caracena/chile-geojson/${COMUNAS_COMMIT}/${n}.geojson`;
const NE_COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';
const NE_LAND_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_land.geojson';

// ---------------------------------------------------------------------------
// Catálogo oficial (orden norte -> sur)
// ---------------------------------------------------------------------------
const REGIONS = [
  { code: 15, roman: 'XV', name: 'Arica y Parinacota', short: 'Arica y Parinacota', zone: 'norte-grande' },
  { code: 1, roman: 'I', name: 'Tarapacá', short: 'Tarapacá', zone: 'norte-grande' },
  { code: 2, roman: 'II', name: 'Antofagasta', short: 'Antofagasta', zone: 'norte-grande' },
  { code: 3, roman: 'III', name: 'Atacama', short: 'Atacama', zone: 'norte-chico' },
  { code: 4, roman: 'IV', name: 'Coquimbo', short: 'Coquimbo', zone: 'norte-chico' },
  { code: 5, roman: 'V', name: 'Valparaíso', short: 'Valparaíso', zone: 'centro' },
  { code: 13, roman: 'RM', name: 'Metropolitana de Santiago', short: 'Metropolitana', zone: 'centro' },
  { code: 6, roman: 'VI', name: "Libertador General Bernardo O'Higgins", short: "O'Higgins", zone: 'centro' },
  { code: 7, roman: 'VII', name: 'Maule', short: 'Maule', zone: 'centro' },
  { code: 16, roman: 'XVI', name: 'Ñuble', short: 'Ñuble', zone: 'centro-sur' },
  { code: 8, roman: 'VIII', name: 'Biobío', short: 'Biobío', zone: 'centro-sur' },
  { code: 9, roman: 'IX', name: 'La Araucanía', short: 'La Araucanía', zone: 'centro-sur' },
  { code: 14, roman: 'XIV', name: 'Los Ríos', short: 'Los Ríos', zone: 'sur' },
  { code: 10, roman: 'X', name: 'Los Lagos', short: 'Los Lagos', zone: 'sur' },
  { code: 11, roman: 'XI', name: 'Aysén del General Carlos Ibáñez del Campo', short: 'Aysén', zone: 'austral' },
  { code: 12, roman: 'XII', name: 'Magallanes y de la Antártica Chilena', short: 'Magallanes', zone: 'austral' },
];

// Correcciones de nombres respecto de la fuente (grafía oficial).
const COMUNA_NAME_FIX = {
  5502: 'La Calera',
  6204: 'Marchihue',
  8206: 'Los Álamos',
  8301: 'Los Ángeles',
};
const PROVINCE_FIX = { Chiloe: 'Chiloé', 'Ultima Esperanza': 'Última Esperanza', 'Bío-Bío': 'Biobío' };
const PROVINCE_BY_CODE_FIX = { 14107: 'Valdivia' };

// La fuente no incluye la comuna de Antártica: se agrega a mano.
const EXTRA_COMUNAS = [
  { code: 12202, name: 'Antártica', province: 'Antártica Chilena', region: 12, areaKm2: null },
];

const ISLAND_RAPA_NUI = 5201;
const ISLAND_JUAN_FERNANDEZ = 5104;
const ANTARTICA = 12202;

// Valores especiales de la grilla
const V_EMPTY = 0; // fondo
const V_FRAME = 1; // marco de recuadros
const V_OTHER = 2; // tierra fuera de Chile (países vecinos, Antártica fuera del sector chileno)
const V_FIRST = 3; // v >= 3 -> codes[v - 3]

// ---------------------------------------------------------------------------
// Descarga con caché
// ---------------------------------------------------------------------------
async function cached(url, name) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, name);
  if (!fs.existsSync(file)) {
    process.stdout.write(`  descargando ${url}\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------
/** Devuelve la geometría como lista de partes; cada parte es una lista de anillos [[lon,lat],...]. */
function parts(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return a / 2;
}

function ringCentroid(ring) {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * f;
    y += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) return ring[0];
  return [x / (3 * a), y / (3 * a)];
}

/** Bbox de un conjunto de partes en coordenadas geográficas. */
function bboxOf(partList) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of partList) for (const ring of p) for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

const bboxIntersects = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

// ---------------------------------------------------------------------------
// Rasterizador (scanline, regla par-impar) sobre una grilla con proyección
// ---------------------------------------------------------------------------
class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint16Array(w * h);
  }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? V_EMPTY : this.data[y * this.w + x]; }
  set(x, y, v) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = v; }
  blit(src, ox, oy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x];
      if (v !== V_EMPTY) this.set(ox + x, oy + y, v);
    }
  }
  /** Rectángulo libre para un recuadro: mar o países vecinos (el recuadro "flota" encima). */
  isEmptyRect(x, y, w, h) {
    if (x < 0 || y < 0 || x + w > this.w || y + h > this.h) return false;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const v = this.data[j * this.w + i];
      if (v !== V_EMPTY && v !== V_OTHER) return false;
    }
    return true;
  }
  padded(left, top, right, bottom) {
    const g = new Grid(this.w + left + right, this.h + top + bottom);
    g.blit(this, left, top);
    return g;
  }
}

/**
 * Rasteriza `items` ({value, parts}) con la proyección `project(lon,lat) -> [X,Y]`.
 * `cell` es el tamaño de celda en unidades proyectadas. Si `bounds` (en unidades
 * proyectadas) no se entrega, se usa el bbox de los ítems marcados como `fit`.
 * `valueAt(value, X, Y)` permite decidir el valor por celda (p. ej. sector antártico).
 * Garantiza al menos una celda por ítem con `ensure: true`.
 */
function rasterize({ items, project, cell, bounds, margin = 1, valueAt }) {
  const projected = items.map((it) => ({
    ...it,
    pparts: it.parts.map((p) => p.map((ring) => ring.map(([lon, lat]) => project(lon, lat)))),
  }));
  if (!bounds) {
    bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const it of projected) if (it.fit !== false) {
      const b = bboxOf(it.pparts);
      bounds.x0 = Math.min(bounds.x0, b.x0); bounds.y0 = Math.min(bounds.y0, b.y0);
      bounds.x1 = Math.max(bounds.x1, b.x1); bounds.y1 = Math.max(bounds.y1, b.y1);
    }
  }
  const X0 = bounds.x0 - margin * cell;
  const Y0 = bounds.y0 - margin * cell;
  const w = Math.ceil((bounds.x1 - bounds.x0) / cell) + 2 * margin;
  const h = Math.ceil((bounds.y1 - bounds.y0) / cell) + 2 * margin;
  const grid = new Grid(w, h);
  const counts = new Map();

  for (const it of projected) {
    // Aristas de todas las partes/anillos del ítem, agrupadas por fila.
    const rows = new Map();
    for (const p of it.pparts) for (const ring of p) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xa, ya] = ring[j];
        const [xb, yb] = ring[i];
        if (ya === yb) continue;
        const ymin = Math.min(ya, yb), ymax = Math.max(ya, yb);
        const r0 = Math.max(0, Math.ceil((ymin - Y0) / cell - 0.5));
        const r1 = Math.min(h - 1, Math.floor((ymax - Y0) / cell - 0.5));
        for (let r = r0; r <= r1; r++) {
          const Y = Y0 + (r + 0.5) * cell;
          if (Y < ymin || Y >= ymax) continue;
          const X = xa + ((Y - ya) * (xb - xa)) / (yb - ya);
          let list = rows.get(r);
          if (!list) rows.set(r, (list = []));
          list.push(X);
        }
      }
    }
    let n = 0;
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - X0) / cell - 0.5));
        const c1 = Math.min(w - 1, Math.floor((xs[k + 1] - X0) / cell - 0.5));
        for (let c = c0; c <= c1; c++) {
          let v = it.value;
          if (valueAt) v = valueAt(v, X0 + (c + 0.5) * cell, Y0 + (r + 0.5) * cell);
          grid.data[r * w + c] = v;
          n++;
        }
      }
    }
    counts.set(it.value, (counts.get(it.value) || 0) + n);
  }

  // Garantizar que comunas muy pequeñas tengan al menos un pixel.
  const real = new Map();
  for (const v of grid.data) real.set(v, (real.get(v) || 0) + 1);
  for (const it of projected) {
    if (!it.ensure || real.get(it.value)) continue;
    let best = null, bestA = 0;
    for (const p of it.parts) { const a = Math.abs(ringArea(p[0])); if (a > bestA) { bestA = a; best = p[0]; } }
    if (!best) continue;
    const [lon, lat] = ringCentroid(best);
    const [X, Y] = project(lon, lat);
    const c = Math.floor((X - X0) / cell), r = Math.floor((Y - Y0) / cell);
    if (c < 0 || r < 0 || c >= w || r >= h) continue;
    const prev = grid.data[r * w + c];
    if (prev !== V_EMPTY && (real.get(prev) || 0) <= 1) continue;
    grid.data[r * w + c] = it.value;
    real.set(prev, (real.get(prev) || 1) - 1);
    real.set(it.value, 1);
  }
  return grid;
}

/**
 * Rellena huecos de 1-2 celdas entre Chile y un país vecino (los límites de
 * Natural Earth y de la BCN no calzan perfecto) para que no parezcan mar.
 */
function fillBorderGaps(grid, reach = 2) {
  const { w, h, data } = grid;
  const kind = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const v = data[y * w + x];
    return v >= V_FIRST ? 1 : v === V_OTHER ? 2 : 0;
  };
  const fills = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[y * w + x] !== V_EMPTY) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      let a = 0, b = 0;
      for (let k = 1; k <= reach && !a; k++) a = kind(x - dx * k, y - dy * k);
      for (let k = 1; k <= reach && !b; k++) b = kind(x + dx * k, y + dy * k);
      if ((a === 1 && b === 2) || (a === 2 && b === 1) || (a === 2 && b === 2)) { fills.push(y * w + x); break; }
    }
  }
  for (const j of fills) data[j] = V_OTHER;
  return grid;
}

// Ruido determinista (para bordes de nubes irregulares).
function hash2(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(x, y, s) {
  const gx = Math.floor(x / s), gy = Math.floor(y / s);
  const fx = x / s - gx, fy = y / s - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(gx, gy), b = hash2(gx + 1, gy), c = hash2(gx, gy + 1), d = hash2(gx + 1, gy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Deja los países vecinos sólo como una franja de ancho irregular junto a
 * Chile (cordillera + nubes), en vez de rectángulos cortados por el borde.
 */
function trimNeighbours(grid, min = 5, extra = 6) {
  const { w, h, data } = grid;
  const dist = new Uint8Array(w * h).fill(255);
  let frontier = [];
  for (let j = 0; j < w * h; j++) if (data[j] >= V_FIRST) { dist[j] = 0; frontier.push(j); }
  const max = min + extra;
  for (let d = 1; d <= max && frontier.length; d++) {
    const next = [];
    for (const j of frontier) {
      const x = j % w;
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (n < 0 || n >= w * h || dist[n] !== 255 || data[n] !== V_OTHER) continue;
        dist[n] = d;
        next.push(n);
      }
    }
    frontier = next;
  }
  for (let j = 0; j < w * h; j++) {
    if (data[j] !== V_OTHER) continue;
    const x = j % w, y = Math.floor(j / w);
    const limit = min + extra * (0.6 * noise2(x, y, 9) + 0.4 * noise2(x + 50, y, 3));
    if (dist[j] > limit) data[j] = V_EMPTY;
  }
  return grid;
}

function frame(grid) {
  const g = grid.padded(1, 1, 1, 1);
  for (let x = 0; x < g.w; x++) { g.set(x, 0, V_FRAME); g.set(x, g.h - 1, V_FRAME); }
  for (let y = 0; y < g.h; y++) { g.set(0, y, V_FRAME); g.set(g.w - 1, y, V_FRAME); }
  return g;
}

/** Busca un rectángulo vacío (con 1 celda de holgura) para pegar un recuadro. */
function findSpot(grid, w, h, prefer, reserved = []) {
  const overlaps = (x, y) => reserved.some((r) => x < r.x + r.w && x + w + 2 > r.x && y < r.y + r.h && y + h + 2 > r.y);
  const xs = [...Array(Math.max(0, grid.w - w + 1)).keys()];
  const ys = [...Array(Math.max(0, grid.h - h + 1)).keys()];
  if (prefer.includes('right')) xs.reverse();
  if (prefer.includes('bottom')) ys.reverse();
  // Recorre primero a lo largo del borde preferido (columna o fila).
  const colsFirst = prefer.includes('right') || prefer.includes('left');
  for (const a of colsFirst ? xs : ys) for (const b of colsFirst ? ys : xs) {
    const [x, y] = colsFirst ? [a, b] : [b, a];
    if (grid.isEmptyRect(x - 1, y - 1, w + 2, h + 2) && !overlaps(x - 1, y - 1)) return { x, y };
  }
  return null;
}

/** Pega recuadros buscando espacio libre; si no hay, agranda la grilla. */
const LABEL_ROWS = 4; // espacio bajo cada recuadro para su etiqueta

function placeInsets(grid, insets, prefer, growSide = 'left') {
  const placed = [];
  for (const ins of insets) {
    const h = ins.grid.h + LABEL_ROWS;
    let spot = findSpot(grid, ins.grid.w, h, ins.prefer || prefer, placed.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h + LABEL_ROWS })));
    if (!spot) {
      const extra = growSide === 'left' || growSide === 'right' ? ins.grid.w + 2 : h + 2;
      const pad = { left: 0, top: 0, right: 0, bottom: 0, [growSide]: extra };
      grid = grid.padded(pad.left, pad.top, pad.right, pad.bottom);
      for (const p of placed) { p.x += pad.left; p.y += pad.top; }
      spot = findSpot(grid, ins.grid.w, h, ins.prefer || prefer, placed.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h + LABEL_ROWS })));
      if (!spot) throw new Error(`No hay espacio para el recuadro ${ins.id}`);
    }
    grid.blit(ins.grid, spot.x, spot.y);
    placed.push({ id: ins.id, label: ins.label, x: spot.x, y: spot.y, w: ins.grid.w, h: ins.grid.h });
  }
  return { grid, placed };
}

function rle(data) {
  const out = [];
  let prev = data[0], n = 0;
  for (const v of data) {
    if (v === prev) n++;
    else { out.push(prev, n); prev = v; n = 1; }
  }
  out.push(prev, n);
  return out;
}

// ---------------------------------------------------------------------------
// Proyecciones
// ---------------------------------------------------------------------------
const D2R = Math.PI / 180;
const sinusoidal = (lon0) => (lon, lat) => [(lon - lon0) * Math.cos(lat * D2R), -lat];
const equirect = (lat0) => (lon, lat) => [lon * Math.cos(lat0 * D2R), -lat];
// Estereográfica polar sur; el meridiano `lonc` apunta hacia arriba.
const polarSouth = (lonc) => (lon, lat) => {
  const r = 2 * Math.tan(((90 + Math.max(lat, -89.999)) / 2) * D2R) * (180 / Math.PI);
  const a = (lon - lonc) * D2R;
  return [r * Math.sin(a), -r * Math.cos(a)];
};

// ---------------------------------------------------------------------------
async function main() {
  console.log('Cargando fuentes…');
  const features = [];
  for (let n = 1; n <= 16; n++) {
    const fc = await cached(COMUNAS_URL(n), `comunas-${n}.geojson`);
    features.push(...fc.features);
  }
  const land = await cached(NE_LAND_URL, 'ne_50m_land.geojson');
  const countries = await cached(NE_COUNTRIES_URL, 'ne_50m_admin_0_countries.geojson');
  // Países vecinos: se dibujan primero (las comunas chilenas quedan encima).
  const neighbours = countries.features
    .filter((f) => ['Argentina', 'Bolivia', 'Peru'].includes(f.properties.ADMIN))
    .map((f) => ({ value: V_OTHER, parts: parts(f.geometry), fit: false }));

  // --- Catálogo -----------------------------------------------------------
  const regionByCode = new Map(REGIONS.map((r) => [r.code, r]));
  const comunas = [];
  const geom = new Map(); // code -> parts
  for (const f of features) {
    const p = f.properties;
    const code = Number(p.cod_comuna);
    if (!regionByCode.has(Number(p.codregion))) throw new Error(`Región desconocida ${p.codregion}`);
    if (geom.has(code)) throw new Error(`Comuna duplicada ${code}`);
    geom.set(code, parts(f.geometry));
    let province = PROVINCE_FIX[p.Provincia] || p.Provincia;
    province = PROVINCE_BY_CODE_FIX[code] || province;
    comunas.push({
      code,
      name: COMUNA_NAME_FIX[code] || p.Comuna,
      province,
      region: Number(p.codregion),
      areaKm2: Math.round(p.st_area_sh / 1e5) / 10,
    });
  }
  comunas.push(...EXTRA_COMUNAS);
  const regionOrder = new Map(REGIONS.map((r, i) => [r.code, i]));
  comunas.sort((a, b) => regionOrder.get(a.region) - regionOrder.get(b.region) || a.code - b.code);
  if (comunas.length !== 346) throw new Error(`Se esperaban 346 comunas, hay ${comunas.length}`);

  const regions = REGIONS.map((r, i) => {
    const cs = comunas.filter((c) => c.region === r.code);
    return {
      code: r.code, roman: r.roman, name: r.name, shortName: r.short, zone: r.zone, order: i + 1,
      comunaCount: cs.length,
      areaKm2: Math.round(cs.reduce((s, c) => s + (c.areaKm2 || 0), 0)),
    };
  });

  const codes = comunas.map((c) => c.code);
  const valueOf = new Map(codes.map((c, i) => [c, V_FIRST + i]));

  // --- Recuadros (insulares y antártico) ----------------------------------
  const clipParts = (code, box) => geom.get(code).filter((p) => bboxIntersects(bboxOf([p]), box));

  const rapaNuiParts = clipParts(ISLAND_RAPA_NUI, { x0: -109.6, x1: -109.1, y0: -27.4, y1: -26.9 });
  const jfParts = clipParts(ISLAND_JUAN_FERNANDEZ, { x0: -79.2, x1: -78.6, y0: -33.9, y1: -33.4 });

  const insetIsland = (code, ps, targetW) => {
    const b = bboxOf(ps);
    const lat0 = (b.y0 + b.y1) / 2;
    const proj = equirect(lat0);
    const wProj = (b.x1 - b.x0) * Math.cos(lat0 * D2R);
    return frame(rasterize({ items: [{ value: valueOf.get(code), parts: ps, ensure: true }], project: proj, cell: wProj / targetW, margin: 2 }));
  };

  const antarcticInset = (targetW) => {
    const lonc = -71.5; // centro del Territorio Chileno Antártico (53°O – 90°O)
    const proj = polarSouth(lonc);
    // Ventana: península antártica y el sector chileno hasta ~80°S.
    const [, yTop] = proj(lonc, -61.2);
    const [, yBottom] = proj(lonc, -80);
    const halfW = Math.abs(proj(-53, -61.2)[0]) * 1.1;
    const bounds = { x0: -halfW, x1: halfW, y0: yTop, y1: yBottom };
    const cell = (2 * halfW) / targetW;
    const items = land.features
      .map((f) => parts(f.geometry).filter((p) => bboxOf([p]).y0 < -59))
      .filter((ps) => ps.length)
      .map((ps) => ({ value: valueOf.get(ANTARTICA), parts: ps, fit: false }));
    const g = rasterize({
      items, project: proj, cell, bounds, margin: 1,
      valueAt: (v, X, Y) => {
        const dl = Math.atan2(X, -Y) / D2R; // desviación respecto de lonc
        const lon = lonc + dl;
        return lon >= -90 && lon <= -53 ? v : V_OTHER;
      },
    });
    // Líneas punteadas que marcan los límites 53°O y 90°O.
    for (const lonEdge of [-53, -90]) {
      for (let t = 0; t < 1200; t++) {
        const lat = -90 + t * 0.025;
        const [X, Y] = proj(lonEdge, lat);
        const c = Math.floor((X - (bounds.x0 - cell)) / cell);
        const r = Math.floor((Y - (bounds.y0 - cell)) / cell);
        if ((c + r) % 2 === 0 && g.get(c, r) === V_EMPTY) g.set(c, r, V_FRAME);
      }
    }
    return frame(g);
  };

  const insets = {
    rapanui: () => ({ id: 'rapanui', label: 'Rapa Nui', grid: insetIsland(ISLAND_RAPA_NUI, rapaNuiParts, 24) }),
    jf: () => ({ id: 'juanfernandez', label: 'Juan Fernández', grid: insetIsland(ISLAND_JUAN_FERNANDEZ, jfParts, 30) }),
    antartica: () => ({ id: 'antartica', label: 'Antártica', grid: antarcticInset(26) }),
  };

  const mainlandItems = (filter) =>
    comunas
      .filter((c) => geom.has(c.code) && c.code !== ISLAND_RAPA_NUI && c.code !== ISLAND_JUAN_FERNANDEZ && filter(c))
      .map((c) => ({ value: valueOf.get(c.code), parts: geom.get(c.code), ensure: true }));

  const maps = {};

  // --- Mapa nacional: tres tramos (norte, centro, sur) + recuadros ---------
  {
    const proj = sinusoidal(-71);
    const cell = 0.07;
    const strips = [
      { label: 'NORTE', regions: [15, 1, 2, 3, 4] },
      { label: 'CENTRO', regions: [5, 13, 6, 7, 16, 8, 9, 14, 10] },
      { label: 'SUR', regions: [11, 12] },
    ].map((s) => {
      const own = mainlandItems((c) => s.regions.includes(c.region));
      // Bbox proyectado del tramo, con espacio al este para los Andes y las nubes.
      const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const it of own) for (const p of it.parts) for (const ring of p) for (const [lon, lat] of ring) {
        const [X, Y] = proj(lon, lat);
        b.x0 = Math.min(b.x0, X); b.x1 = Math.max(b.x1, X); b.y0 = Math.min(b.y0, Y); b.y1 = Math.max(b.y1, Y);
      }
      const bounds = { x0: b.x0 - 2 * cell, x1: b.x1 + 9 * cell, y0: b.y0 - cell, y1: b.y1 + cell };
      return { ...s, grid: trimNeighbours(fillBorderGaps(rasterize({ items: [...neighbours, ...own], project: proj, cell, bounds, margin: 0 }))) };
    });
    const gap = 3, top = 7;
    const W = strips.reduce((s, x) => s + x.grid.w, 0) + gap * (strips.length - 1);
    const H = Math.max(...strips.map((s) => s.grid.h)) + top;
    let grid = new Grid(W, H);
    const labels = [];
    let ox = 0;
    for (const s of strips) {
      grid.blit(s.grid, ox, top);
      labels.push({ text: s.label, x: ox + s.grid.w / 2, y: 2.5 });
      ox += s.grid.w + gap;
    }
    const res = placeInsets(grid, [insets.rapanui(), insets.jf(), insets.antartica()], ['right'], 'right');
    maps.chile = { title: 'Chile', w: res.grid.w, h: res.grid.h, labels, insets: res.placed, rle: rle(res.grid.data) };
    console.log(`  chile: ${res.grid.w}×${res.grid.h}`);
  }

  // --- Mapa de cada región -------------------------------------------------
  for (const r of REGIONS) {
    const own = mainlandItems((c) => c.region === r.code);
    const b = bboxOf(own.flatMap((it) => it.parts));
    const lat0 = (b.y0 + b.y1) / 2;
    const proj = equirect(lat0);
    const kx = Math.cos(lat0 * D2R);
    const longest = Math.max((b.x1 - b.x0) * kx, b.y1 - b.y0);
    // Celda: ~110 pixeles en el lado mayor, pero la comuna más chica debe tener >= 3 pixeles.
    const smallest = Math.min(...comunas.filter((c) => c.region === r.code && c.areaKm2).map((c) => c.areaKm2));
    let cell = Math.min(longest / 110, Math.sqrt(smallest / 3) / 111);
    cell = Math.max(cell, longest / 200);
    const pad = 0.04 * longest;
    const window = { x0: b.x0 - pad / kx, x1: b.x1 + pad / kx, y0: b.y0 - pad, y1: b.y1 + pad };
    // Comunas vecinas (otras regiones) también se dibujan, atenuadas en el cliente.
    const items = mainlandItems((c) => bboxIntersects(bboxOf(geom.get(c.code)), window)).map((it) => ({
      ...it, fit: false, ensure: own.some((o) => o.value === it.value),
    }));
    const [px0, py1] = proj(window.x0, window.y0);
    const [px1, py0] = proj(window.x1, window.y1);
    let grid = fillBorderGaps(rasterize({ items: [...neighbours, ...items], project: proj, cell, bounds: { x0: px0, x1: px1, y0: py0, y1: py1 }, margin: 0 }));
    let placed = [];
    if (r.code === 5) ({ grid, placed } = placeInsets(grid, [insets.rapanui(), insets.jf()], ['bottom'], 'left'));
    if (r.code === 12) ({ grid, placed } = placeInsets(grid, [insets.antartica()], ['right'], 'right'));
    maps[`r${r.code}`] = { title: r.short, region: r.code, w: grid.w, h: grid.h, labels: [], insets: placed, rle: rle(grid.data) };
    console.log(`  r${r.code}: ${grid.w}×${grid.h}`);
  }

  // --- Zoom Gran Santiago (comunas muy pequeñas) --------------------------
  {
    const window = { x0: -70.86, x1: -70.43, y0: -33.66, y1: -33.29 };
    const lat0 = (window.y0 + window.y1) / 2;
    const proj = equirect(lat0);
    const [px0, py1] = proj(window.x0, window.y0);
    const [px1, py0] = proj(window.x1, window.y1);
    const cell = (px1 - px0) / 112;
    const items = mainlandItems((c) => bboxIntersects(bboxOf(geom.get(c.code)), window)).map((it) => ({ ...it, fit: false }));
    const grid = rasterize({ items, project: proj, cell, bounds: { x0: px0, x1: px1, y0: py0, y1: py1 }, margin: 0 });
    maps.santiago = { title: 'Gran Santiago', region: 13, w: grid.w, h: grid.h, labels: [], insets: [], rle: rle(grid.data) };
    console.log(`  santiago: ${grid.w}×${grid.h}`);
  }

  // --- Verificación: cada comuna aparece en el mapa de su región ----------
  for (const c of comunas) {
    const m = maps[`r${c.region}`];
    const v = valueOf.get(c.code);
    let found = false;
    for (let i = 0; i < m.rle.length && !found; i += 2) if (m.rle[i] === v) found = true;
    if (!found) throw new Error(`La comuna ${c.name} (${c.code}) no quedó dibujada en su región`);
  }

  // --- Escritura -------------------------------------------------------------
  fs.mkdirSync(OUT, { recursive: true });
  const catalog = {
    version: 1,
    source: 'Límites: Biblioteca del Congreso Nacional de Chile (vía caracena/chile-geojson). Antártica: Natural Earth.',
    regions,
    comunas,
  };
  fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog));
  const mapsOut = { version: 1, special: { empty: V_EMPTY, frame: V_FRAME, other: V_OTHER, first: V_FIRST }, codes, maps };
  fs.writeFileSync(path.join(OUT, 'maps.json'), JSON.stringify(mapsOut));
  const kb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0);
  console.log(`Listo: catalog.json (${kb('catalog.json')} KB), maps.json (${kb('maps.json')} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
