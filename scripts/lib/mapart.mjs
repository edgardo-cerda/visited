/**
 * Generador del arte inicial de los mapas (estilo "mapa de videojuego").
 *
 * Es el dibujo procedural que usaba la web: mar con orilla y espuma, terreno
 * según la zona, cordillera nevada y nubes sobre los países vecinos. Ahora se
 * usa sólo para crear los PNG de public/img/maps/, que después se pueden
 * editar a mano (ver docs/ARTE.md).
 */
// ---------------------------------------------------------------------------
// Colores
// ---------------------------------------------------------------------------
const C = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
const WHITE = [255, 255, 255], BLACK = [20, 16, 30];

export const COLORS = {
  oceanDeep: C('#1690d6'),
  ocean: C('#1ea6ea'),
  shallow2: C('#3cbcf0'),
  shallow: C('#62cff5'),
  foam: C('#c9f2ff'),
  sparkle: C('#9fe3fb'),
  cloudLight: C('#f4f3fa'),
  cloud: C('#e1dfee'),
  cloudShade: C('#c9c6dd'),
  cloudEdge: C('#aba7c6'),
  slopeLight: C('#e2b58a'),
  slope: C('#c68f66'),
  slopeDark: C('#9a6a4e'),
  snow: C('#ffffff'),
  snowShade: C('#cdd2ea'),
  rock: C('#7b5b4b'),
  frame: C('#5a4030'),
  fog: C('#c9c9cc'),
  hover: C('#fff3a6'),
  hoverEdge: C('#f0a030'),
  focus: C('#ff7b6b'),
  focusEdge: C('#c4473b'),
};

/** Color de terreno de cada región (norte → sur). */
const BIOME = {
  15: '#f4d27a', 1: '#f2cc70', 2: '#efc468', 3: '#e3c76c', 4: '#d2cd6d',
  5: '#bdd46c', 13: '#add46b', 6: '#9fd26b', 7: '#8ece6c', 16: '#7cc96f',
  8: '#6bc372', 9: '#5bbb73', 14: '#49b276', 10: '#3ca877', 11: '#2f9b74', 12: '#55a184',
};
const COMUNA_BIOME = { 5201: '#7fcf6a', 5104: '#5cbf6c', 12202: '#eef4ff' };

const tones = (base) => ({
  light: mix(base, WHITE, 0.35),
  base,
  dark: mix(base, BLACK, 0.22),
  border: mix(base, BLACK, 0.38),
});
// Sin visitar: el terreno en escala de grises, bajo una niebla gris.
const gray = (c) => { const l = Math.round(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]); return [l, l, l]; };
const fogged = (t) => ({
  light: mix(gray(t.light), COLORS.fog, 0.55),
  base: mix(gray(t.base), COLORS.fog, 0.6),
  dark: mix(gray(t.dark), COLORS.fog, 0.45),
  border: mix(gray(t.border), COLORS.fog, 0.3),
});
// Visitado pero fuera de la región enfocada: colores apagados.
const muted = (t) => ({
  light: mix(t.light, COLORS.fog, 0.55),
  base: mix(t.base, COLORS.fog, 0.55),
  dark: mix(t.dark, COLORS.fog, 0.45),
  border: mix(t.border, COLORS.fog, 0.35),
});
const toneCache = new Map();
const OUT_OF_FOCUS = { light: COLORS.cloud, base: COLORS.cloud, dark: COLORS.cloudShade, border: COLORS.cloudEdge };
/** Paleta completa (visitado) y con niebla (sin visitar) de una comuna. */
export function terrain(comuna, region) {
  const key = COMUNA_BIOME[comuna] ? comuna : -region;
  let t = toneCache.get(key);
  if (!t) {
    const full = tones(C(COMUNA_BIOME[comuna] || BIOME[region] || '#8fce6c'));
    t = { full, fog: fogged(full), dimVisited: muted(full) };
    toneCache.set(key, t);
  }
  return t;
}

// Ruido determinista para texturas (nubes, mar).
export function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y, s) {
  const gx = Math.floor(x / s), gy = Math.floor(y / s);
  const fx = x / s - gx, fy = y / s - gy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(gx, gy), b = hash(gx + 1, gy), c = hash(gx, gy + 1), d = hash(gx + 1, gy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Mar abierto: manchas de agua profunda con borde tramado (dither). */
export function deepWater(x, y) {
  const n = noise(x + 0.6 * y, y, 16) * 0.7 + noise(x, y, 5) * 0.3;
  if (n > 0.64) return COLORS.oceanDeep;
  if (n > 0.6) return (x + y) % 2 ? COLORS.oceanDeep : COLORS.ocean;
  return COLORS.ocean;
}

/** Distancia (4-vecinos) desde las celdas `from` a través de las celdas `through`, hasta `max`. */
export function distanceField(w, h, from, through, max) {
  const dist = new Uint8Array(w * h).fill(255);
  let frontier = [];
  for (let j = 0; j < w * h; j++) if (from(j)) { dist[j] = 0; frontier.push(j); }
  for (let d = 1; d <= max && frontier.length; d++) {
    const next = [];
    for (const j of frontier) {
      const x = j % w;
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) {
        if (n < 0 || n >= w * h || dist[n] !== 255 || !through(n)) continue;
        dist[n] = d;
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

// Sprite de cumbre nevada (9×6): S nieve, s sombra, R roca, r roca oscura
const PEAK = [
  '....S....',
  '...SSs...',
  '..SSSss..',
  '.RSSRsrR.',
  'RRRRRrrrr',
  'RRRRrrrrr',
];

/**
 * Capa estática (mar, nubes, cordillera, marcos): se calcula una vez por mapa.
 * Devuelve RGBA con alfa 0 en las celdas chilenas (se pintan en cada draw()).
 */
export function staticLayer(map) {
  if (map.staticLayer) return map.staticLayer;
  const { w, h, data, comuna, special } = map;
  const inInset = (x, y) => map.insets.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const insetMask = new Uint8Array(w * h);
  for (const r of map.insets) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) insetMask[y * w + x] = 1;
  const isChile = (j) => comuna[j] !== 0;
  const isEmpty = (j) => data[j] === special.empty;
  const isOther = (j) => data[j] === special.other;
  const seaDist = distanceField(w, h, (j) => isChile(j) || isOther(j), isEmpty, 9);
  const slopeDist = distanceField(w, h, isChile, (j) => isOther(j) && !insetMask[j], 7);
  const px = new Uint8ClampedArray(w * h * 4);
  const put = (j, c) => { px[j * 4] = c[0]; px[j * 4 + 1] = c[1]; px[j * 4 + 2] = c[2]; px[j * 4 + 3] = 255; };

  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x;
    const v = data[j];
    if (isChile(j)) continue;
    if (v === special.frame) { put(j, COLORS.frame); continue; }
    if (v === special.empty) {
      const d = seaDist[j];
      let c;
      if (d === 1) c = COLORS.foam;
      else if (d === 2) c = (x + y) % 2 ? COLORS.foam : COLORS.shallow;
      else if (d <= 4) c = COLORS.shallow;
      else if (d === 5) c = (x + y) % 2 ? COLORS.shallow : COLORS.shallow2;
      else if (d <= 7) c = COLORS.shallow2;
      else c = deepWater(x, y);
      put(j, c);
      continue;
    }
    // País vecino: ladera cerca de Chile, nubes más allá.
    const d = slopeDist[j];
    let c;
    if (d <= 2) c = COLORS.slopeDark;
    else if (d === 3) c = (x + y) % 2 ? COLORS.slope : COLORS.slopeDark;
    else if (d === 4) c = COLORS.slope;
    else if (d === 5) c = (x + y) % 2 ? COLORS.slopeLight : COLORS.slope;
    else if (d === 6) c = (x + y) % 2 ? COLORS.slopeLight : COLORS.cloudShade;
    else {
      const n = noise(x + 0.5 * y, y, 11) * 0.7 + noise(x, y, 4) * 0.3;
      c = n > 0.62 ? COLORS.cloudLight : n < 0.36 ? COLORS.cloudShade : COLORS.cloud;
      if (seaDist[j] === 0) {
        // borde de nube sobre el mar
        const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w];
        if (nb.some((n) => n >= 0 && n < w * h && isEmpty(n))) c = COLORS.cloudEdge;
      }
    }
    put(j, c);
  }

  // Destellos en el mar abierto.
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 2; x++) {
    const j = y * w + x;
    if (seaDist[j] >= 9 && seaDist[j + 1] >= 9 && seaDist[j + 2] >= 9 && hash(x, y) < 0.008) {
      put(j, COLORS.sparkle); put(j + 1, COLORS.sparkle); put(j + 2, COLORS.sparkle);
    }
  }

  // Cumbres nevadas sobre la ladera, a lo largo del borde oriental.
  const PH = PEAK.length, PW = PEAK[0].length;
  for (let y = PH; y < h; y++) {
    if ((y + Math.floor(hash(1, y) * 4)) % 9 !== 0) continue;
    for (let x = 1; x < w; x++) {
      const j = y * w + x;
      if (!(isOther(j) && isChile(j - 1)) || inInset(x, y)) continue;
      const ox = x + 1, oy = y - PH + 1;
      for (let r = 0; r < PH; r++) for (let c = 0; c < PW; c++) {
        const ch = PEAK[r][c];
        const tx = ox + c, ty = oy + r, tj = ty * w + tx;
        if (ch === '.' || tx >= w || ty < 0 || ty >= h || !isOther(tj)) continue;
        put(tj, ch === 'S' ? COLORS.snow : ch === 's' ? COLORS.snowShade : ch === 'r' ? COLORS.slopeDark : COLORS.rock);
      }
      break;
    }
  }
  map.staticLayer = px;
  return px;
}


/** Decodifica un mapa de maps.json (RLE) y calcula comuna/región por celda. */
export function decodeMap(id, mapsRaw, catalog) {
  const m = mapsRaw.maps[id];
  const data = new Uint16Array(m.w * m.h);
  let i = 0;
  for (let k = 0; k < m.rle.length; k += 2) { data.fill(m.rle[k], i, i + m.rle[k + 1]); i += m.rle[k + 1]; }
  const { first } = mapsRaw.special;
  const regionOf = new Map(catalog.comunas.map((c) => [c.code, c.region]));
  const comuna = new Int32Array(m.w * m.h), region = new Int32Array(m.w * m.h);
  for (let j = 0; j < data.length; j++) {
    if (data[j] >= first) { comuna[j] = mapsRaw.codes[data[j] - first]; region[j] = regionOf.get(comuna[j]) || 0; }
  }
  return { id, ...m, rle: undefined, data, comuna, region, special: mapsRaw.special };
}

/**
 * Arte a todo color de un mapa (como se ve todo visitado): fondo + terreno con
 * sombreado en la costa. Los bordes entre comunas y la niebla de lo no
 * visitado los agrega la web al dibujar.
 */
export function renderMapArt(map) {
  const { w, h, comuna, region } = map;
  const px = new Uint8ClampedArray(staticLayer(map));
  const isLand = (j) => j >= 0 && j < w * h && comuna[j] !== 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x;
    if (!comuna[j]) continue;
    const t = terrain(comuna[j], region[j]).full;
    const right = x + 1 < w ? j + 1 : -1, down = y + 1 < h ? j + w : -1;
    const left = x > 0 ? j - 1 : -1, up = y > 0 ? j - w : -1;
    let c = t.base;
    if (!isLand(right) || !isLand(down)) c = t.dark;
    else if (!isLand(left) || !isLand(up)) c = t.light;
    px.set([c[0], c[1], c[2], 255], j * 4);
  }
  return px;
}

/** Fondo de mar para las imágenes de cada lugar (pósters). */
export function renderPosterOcean(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = deepWater(x, y);
    if (hash(x + 7, y) < 0.012) c = COLORS.sparkle;
    px.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return px;
}
