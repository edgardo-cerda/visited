/**
 * Mapa pixel art: dibuja una grilla (1 celda = 1 pixel) en un <canvas> y la
 * escala con `image-rendering: pixelated`.
 *
 * Estilo "mapa de videojuego": mar con orilla y espuma, terreno según la zona
 * (desierto, valle, bosque…), Andes nevados y países vecinos bajo las nubes.
 * Los lugares sin visitar quedan cubiertos por la niebla y se "descubren" al
 * marcarlos como visitados.
 */
import { mapIndex } from './store.js';
import { landmarksFor, drawSprite } from './landmarks.js';

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
function hash(x, y) {
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
function deepWater(x, y) {
  const n = noise(x + 0.6 * y, y, 16) * 0.7 + noise(x, y, 5) * 0.3;
  if (n > 0.64) return COLORS.oceanDeep;
  if (n > 0.6) return (x + y) % 2 ? COLORS.oceanDeep : COLORS.ocean;
  return COLORS.ocean;
}

/** Distancia (4-vecinos) desde las celdas `from` a través de las celdas `through`, hasta `max`. */
function distanceField(w, h, from, through, max) {
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
function staticLayer(map) {
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

export class PixelMap {
  /**
   * @param {object} opts
   * @param {object} opts.map            mapa decodificado (store.getMap)
   * @param {'comuna'|'region'} opts.mode agrupación de colores y clics
   * @param {(type, code) => string|null} opts.stateOf  'visited' | 'wishlist' | null
   * @param {number} [opts.focusRegion]  atenúa comunas de otras regiones
   * @param {number} [opts.highlight]    comuna resaltada
   * @param {(type, code) => void} [opts.onClick]
   * @param {(type, code) => string} [opts.label] texto del tooltip
   * @param {number} [opts.maxScale]
   */
  constructor(opts) {
    Object.assign(this, { mode: 'comuna', maxScale: 8, ...opts });
    this.hover = null;
    this.el = document.createElement('div');
    this.el.className = 'pixelmap';
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.map.w;
    this.canvas.height = this.map.h;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(this.map.w, this.map.h);
    this.layer = staticLayer(this.map);
    this.overlay = document.createElement('div');
    this.overlay.className = 'pixelmap-overlay';
    this.tip = document.createElement('div');
    this.tip.className = 'pixelmap-tip';
    this.tip.hidden = true;
    this.el.append(this.canvas, this.overlay, this.tip);

    for (const l of this.map.labels || []) this.overlay.append(this.#label(l.text, l.x, l.y, 'strip'));
    for (const ins of this.map.insets || []) this.overlay.append(this.#label(ins.label, ins.x + ins.w / 2, ins.y + ins.h + 1.2, 'inset'));

    if (this.onClick || this.label) {
      this.canvas.addEventListener('mousemove', (e) => this.#move(e));
      this.canvas.addEventListener('mouseleave', () => this.#setHover(null));
      this.canvas.addEventListener('click', (e) => {
        const hit = this.#hit(e);
        if (hit && this.onClick) this.onClick(hit.type, hit.code);
      });
    }
    this.ro = new ResizeObserver(() => this.#resize());
    this.ro.observe(this.el);
    this.draw();
  }

  #label(text, x, y, cls) {
    const d = document.createElement('div');
    d.className = `pixelmap-label ${cls}`;
    d.textContent = text;
    d.dataset.x = x;
    d.dataset.y = y;
    return d;
  }

  #resize() {
    const cw = this.el.clientWidth;
    if (!cw) return;
    // Escala entera cuando hay espacio (pixeles nítidos); si no, ocupa el ancho disponible.
    let s = cw / this.map.w;
    s = s >= 2 ? Math.floor(s) : s;
    s = Math.min(s, this.maxScale);
    this.scale = s;
    this.canvas.style.width = `${this.map.w * s}px`;
    this.canvas.style.height = `${this.map.h * s}px`;
    this.overlay.style.width = this.canvas.style.width;
    this.overlay.style.height = this.canvas.style.height;
    this.overlay.style.setProperty('--px', `${s}px`);
    this.overlay.classList.toggle('tiny', s < 1.5);
    for (const l of this.overlay.children) {
      l.style.left = `${l.dataset.x * s}px`;
      l.style.top = `${l.dataset.y * s}px`;
    }
  }

  #hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.map.w);
    const y = Math.floor(((e.clientY - r.top) / r.height) * this.map.h);
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return null;
    const j = y * this.map.w + x;
    const comuna = this.map.comuna[j];
    if (!comuna) return null;
    return this.mode === 'region' ? { type: 'region', code: this.map.region[j] } : { type: 'comuna', code: comuna };
  }

  #move(e) {
    const hit = this.#hit(e);
    this.#setHover(hit);
    if (hit && this.label) {
      this.tip.hidden = false;
      this.tip.textContent = this.label(hit.type, hit.code);
      const r = this.el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      this.tip.style.left = `${Math.max(4, Math.min(x + 14, r.width - this.tip.offsetWidth - 4))}px`;
      this.tip.style.top = `${y + 16}px`;
    } else {
      this.tip.hidden = true;
    }
    this.canvas.style.cursor = hit && this.onClick ? 'pointer' : 'default';
  }

  #setHover(hit) {
    const key = hit ? `${hit.type}:${hit.code}` : null;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hover = hit;
    if (!hit) this.tip.hidden = true;
    this.draw();
  }

  setMode(mode) { this.mode = mode; this.hover = null; this.hoverKey = null; this.draw(); }
  setHighlight(code) { this.highlight = code; this.draw(); }

  draw() {
    const { w, h, comuna, region } = this.map;
    const px = this.img.data;
    px.set(this.layer);
    const groupOf = this.mode === 'region' ? region : comuna;
    const hoverCode = this.hover?.code;
    const states = new Map();
    const stateFor = (g) => {
      if (!states.has(g)) states.set(g, this.stateOf ? this.stateOf(this.mode, g) : null);
      return states.get(g);
    };
    const isLand = (j) => j >= 0 && comuna[j] !== 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const j = y * w + x;
        const cm = comuna[j];
        if (!cm) continue;
        const g = groupOf[j];
        const rg = region[j];
        const st = stateFor(g);
        const t = terrain(cm, rg);
        const inFocus = !this.focusRegion || rg === this.focusRegion;
        let pal = st === 'visited' ? t.full : t.fog;
        if (st === 'wishlist') pal = (x + y) % 2 ? t.full : t.fog; // medio descubierto
        if (!inFocus) pal = st === 'visited' ? t.dimVisited : OUT_OF_FOCUS;

        const right = x + 1 < w ? j + 1 : -1, down = y + 1 < h ? j + w : -1;
        const left = x > 0 ? j - 1 : -1, up = y > 0 ? j - w : -1;
        const borderRight = isLand(right) && groupOf[right] !== g;
        const borderDown = isLand(down) && groupOf[down] !== g;
        const regionBorder = (isLand(right) && region[right] !== rg) || (isLand(down) && region[down] !== rg);
        let c;
        if (g === hoverCode) {
          c = borderRight || borderDown || !isLand(right) || !isLand(down) || !isLand(left) || !isLand(up) ? COLORS.hoverEdge : mix(pal.base, COLORS.hover, 0.6);
        } else if (cm === this.highlight) {
          c = borderRight || borderDown || !isLand(right) || !isLand(down) ? COLORS.focusEdge : COLORS.focus;
        } else if (regionBorder && this.mode === 'comuna') c = mix(pal.border, BLACK, 0.25);
        else if (borderRight || borderDown) c = pal.border;
        else if (!isLand(right) || !isLand(down)) c = pal.dark;
        else if (!isLand(left) || !isLand(up)) c = pal.light;
        else c = pal.base;
        const o = j * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  destroy() { this.ro.disconnect(); this.el.remove(); }
}

// ---------------------------------------------------------------------------
// "Pósters": la silueta del lugar como una isla en el mar
// ---------------------------------------------------------------------------
export const POSTER_SIZES = { small: [64, 96], large: [112, 168] };

/**
 * Dibuja la silueta del lugar como una isla en el mar.
 * @param {object[]} maps candidatos (el que contenga mejor el lugar)
 * @param {(type, code) => string|null} stateOf
 * @param {{size?: 'small'|'large', icons?: boolean}} [opts]
 *   icons: dibuja los íconos de las comunas visitadas (imagen grande).
 */
export function posterCanvas(type, code, maps, stateOf, { size = 'small', icons = false } = {}) {
  const [PW, PH] = POSTER_SIZES[size];
  const canvas = document.createElement('canvas');
  canvas.width = PW;
  canvas.height = PH;
  canvas.className = 'poster-canvas';
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(PW, PH);

  let best = null;
  for (const m of maps) {
    if (!m) continue;
    const idx = mapIndex(m)[type === 'region' ? 'regions' : 'comunas'];
    const b = idx.get(code);
    if (!b) continue;
    const touches = b.x0 === 0 || b.y0 === 0 || b.x1 === m.w - 1 || b.y1 === m.h - 1;
    const score = b.n * (touches ? 0.2 : 1);
    if (!best || score > best.score) best = { m, b, score };
  }

  // Máscara de la silueta en coordenadas del póster (código de comuna por pixel).
  const mask = new Int32Array(PW * PH);
  const regionOf = new Int32Array(PW * PH);
  if (best) {
    const { m, b } = best;
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const pad = Math.round(PW * 0.12);
    const k = Math.min((PW - pad * 2) / bw, (PH - pad * 2) / bh);
    const scale = k >= 1 ? Math.floor(k) : k;
    const ow = Math.round(bw * scale), oh = Math.round(bh * scale);
    const ox = Math.floor((PW - ow) / 2), oy = Math.floor((PH - oh) / 2);
    for (let py = oy; py < oy + oh; py++) for (let px = ox; px < ox + ow; px++) {
      const sx = b.x0 + Math.floor((px - ox) / scale), sy = b.y0 + Math.floor((py - oy) / scale);
      if (sx > b.x1 || sy > b.y1) continue;
      const j = sy * m.w + sx;
      let c = 0;
      if (type === 'region') {
        const inInset = m.insets.some((r) => sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h);
        if (!inInset && m.region[j] === code) c = m.comuna[j];
      } else if (m.comuna[j] === code) c = code;
      mask[py * PW + px] = c;
      regionOf[py * PW + px] = c ? m.region[j] : 0;
    }
  }

  const dist = distanceField(PW, PH, (j) => mask[j] !== 0, (j) => mask[j] === 0, 5);
  const regionVisited = type === 'region' && stateOf('region', code) === 'visited';
  const put = (x, y, c) => img.data.set([c[0], c[1], c[2], 255], (y * PW + x) * 4);
  const at = (x, y) => (x < 0 || y < 0 || x >= PW || y >= PH ? 0 : mask[y * PW + x]);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const j = y * PW + x;
    const c = mask[j];
    if (!c) {
      const d = dist[j];
      let col;
      if (d === 1) col = COLORS.foam;
      else if (d === 2) col = (x + y) % 2 ? COLORS.foam : COLORS.shallow;
      else if (d <= 4) col = COLORS.shallow;
      else if (d === 5) col = (x + y) % 2 ? COLORS.shallow : COLORS.shallow2;
      else col = deepWater(x + code, y);
      if (d > 5 && hash(x + code, y) < 0.012) col = COLORS.sparkle;
      put(x, y, col);
      continue;
    }
    const st = stateOf('comuna', c);
    const t = terrain(c, regionOf[j]);
    let pal = st === 'visited' ? t.full : t.fog;
    if (st === 'wishlist') pal = (x + y) % 2 ? t.full : t.fog;
    if (type === 'region' && st !== 'visited' && regionVisited) pal = (x + y) % 3 ? t.fog : t.full;
    const edgeR = at(x + 1, y) !== c, edgeD = at(x, y + 1) !== c;
    let col;
    if ((edgeR && at(x + 1, y)) || (edgeD && at(x, y + 1))) col = pal.border;
    else if (edgeR || edgeD) col = pal.dark;
    else if (!at(x - 1, y) || !at(x, y - 1)) col = pal.light;
    else col = pal.base;
    put(x, y, col);
  }

  if (icons) placeIcons(img, type, code, mask, regionOf, stateOf);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Íconos de las comunas visitadas, sobre su ubicación en la silueta. */
function placeIcons(img, type, code, mask, regionOf, stateOf) {
  const PW = img.width, PH = img.height;
  // Centro de cada comuna en el póster.
  const sums = new Map();
  for (let j = 0; j < mask.length; j++) {
    const c = mask[j];
    if (!c) continue;
    let s = sums.get(c);
    if (!s) sums.set(c, (s = { x: 0, y: 0, n: 0, region: regionOf[j] }));
    s.x += j % PW; s.y += Math.floor(j / PW); s.n++;
  }
  if (type === 'comuna') {
    const s = sums.get(code);
    if (!s || stateOf('comuna', code) !== 'visited') return;
    const { sprites } = landmarksFor({ code, region: s.region });
    // En la imagen grande, los íconos de la comuna se dibujan al doble.
    const k = PW >= 100 ? 2 : 1, size = 16 * k;
    const cx = s.x / s.n, cy = s.y / s.n;
    const n = Math.min(2, sprites.length);
    const clamp = (v, max) => Math.max(1, Math.min(max - size - 1, Math.round(v)));
    sprites.slice(0, n).forEach((sp, i) => {
      const dx = n === 2 ? (i ? 1 : -size - 1) : -size / 2;
      drawSprite(img, sp, clamp(cx + dx, PW), clamp(cy - size / 2, PH), { scale: k });
    });
    return;
  }
  const clampX = (x) => Math.max(1, Math.min(PW - 17, Math.round(x)));
  const clampY = (y) => Math.max(1, Math.min(PH - 17, Math.round(y)));
  // Región: un ícono por comuna visitada, primero las que tienen íconos propios, sin encimarse.
  const items = [...sums].filter(([c]) => stateOf('comuna', c) === 'visited')
    .map(([c, s]) => ({ c, s, lm: landmarksFor({ code: c, region: s.region }) }))
    .sort((a, b) => (b.lm.own - a.lm.own) || (b.s.n - a.s.n));
  const placed = [];
  for (const it of items) {
    if (placed.length >= 10) break;
    const x = clampX(it.s.x / it.s.n - 8), y = clampY(it.s.y / it.s.n - 8);
    if (placed.some((p) => Math.abs(p.x - x) < 15 && Math.abs(p.y - y) < 15)) continue;
    drawSprite(img, it.lm.sprites[0], x, y);
    placed.push({ x, y });
  }
}

// ---------------------------------------------------------------------------
// Avatar pixel (identicon simétrico 7×7 a partir del nombre de usuario)
// ---------------------------------------------------------------------------
export function avatarCanvas(seed) {
  let hsh = 2166136261;
  for (const ch of String(seed)) hsh = Math.imul(hsh ^ ch.codePointAt(0), 16777619) >>> 0;
  const rand = () => ((hsh = Math.imul(hsh ^ (hsh >>> 15), 2246822507) >>> 0), hsh / 4294967296);
  const colors = ['#ff6b6b', '#1ea6ea', '#4cbf6b', '#f2a93b', '#9b6bd6', '#ff8fb1', '#2fb3a0'];
  const fg = colors[Math.floor(rand() * colors.length)];
  const N = 7;
  const canvas = document.createElement('canvas');
  canvas.width = N + 2;
  canvas.height = N + 2;
  canvas.className = 'avatar-canvas';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff4dc';
  ctx.fillRect(0, 0, N + 2, N + 2);
  ctx.fillStyle = fg;
  for (let y = 0; y < N; y++) for (let x = 0; x < Math.ceil(N / 2); x++) {
    if (rand() < 0.5) {
      ctx.fillRect(x + 1, y + 1, 1, 1);
      ctx.fillRect(N - x, y + 1, 1, 1);
    }
  }
  return canvas;
}
