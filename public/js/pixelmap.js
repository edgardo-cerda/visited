/**
 * Mapa pixel art: dibuja una grilla (1 celda = 1 pixel) en un <canvas> y la
 * escala con `image-rendering: pixelated`.
 *
 * El dibujo viene de un PNG editable por mapa (public/img/maps/<id>.png, ver
 * docs/ARTE.md) que muestra todo "a todo color". Encima, al dibujar:
 *   - lo no visitado se pasa a gris y queda bajo la niebla,
 *   - "Quiero ir" queda medio despejado (tramado),
 *   - se marcan los bordes entre comunas o regiones, el lugar bajo el mouse, etc.
 */
import { mapIndex, getPosterOcean } from './store.js';
import { landmarksFor, drawSprite } from './landmarks.js';

// ---------------------------------------------------------------------------
// Colores y transformaciones
// ---------------------------------------------------------------------------
const C = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const gray = (c) => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return [l, l, l]; };
const WHITE = [255, 255, 255], BLACK = [20, 16, 30];

export const COLORS = {
  ocean: C('#1ea6ea'),
  shallow2: C('#3cbcf0'),
  shallow: C('#62cff5'),
  foam: C('#c9f2ff'),
  fog: C('#c9c9cc'),
  cloud: C('#e1dfee'),
  hover: C('#fff3a6'),
  hoverEdge: C('#f0a030'),
  focus: C('#ff7b6b'),
  focusEdge: C('#c4473b'),
};

/** Sin visitar: el dibujo en escala de grises, bajo una niebla gris. */
const fogged = (c) => mix(gray(c), COLORS.fog, 0.55);
/** Fuera de la región enfocada: casi nube (sin visitar) o apagado (visitado). */
const outOfFocus = (c, visited) => (visited ? mix(c, COLORS.fog, 0.55) : mix(gray(c), COLORS.cloud, 0.7));
const border = (c, strong) => mix(c, BLACK, strong ? 0.5 : 0.38);

/** Color de un pixel de Chile según el estado del lugar. */
function stateColor(c, st, x, y) {
  if (st === 'visited') return c;
  if (st === 'wishlist') return (x + y) % 2 ? c : fogged(c); // medio descubierto
  return fogged(c);
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
    const { w, h, comuna, region, art } = this.map;
    const px = this.img.data;
    px.set(art);
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
        const o = j * 4;
        const g = groupOf[j], rg = region[j];
        const st = stateFor(g);
        const right = x + 1 < w ? j + 1 : -1, down = y + 1 < h ? j + w : -1;
        const left = x > 0 ? j - 1 : -1, up = y > 0 ? j - w : -1;
        const edgeR = isLand(right) && groupOf[right] !== g;
        const edgeD = isLand(down) && groupOf[down] !== g;
        const regionEdge = (isLand(right) && region[right] !== rg) || (isLand(down) && region[down] !== rg);
        const coast = !isLand(right) || !isLand(down) || !isLand(left) || !isLand(up);
        let c = [art[o], art[o + 1], art[o + 2]];
        if (g === hoverCode) {
          c = edgeR || edgeD || coast ? COLORS.hoverEdge : mix(c, COLORS.hover, 0.6);
        } else if (cm === this.highlight) {
          c = edgeR || edgeD || !isLand(right) || !isLand(down) ? COLORS.focusEdge : COLORS.focus;
        } else {
          c = this.focusRegion && rg !== this.focusRegion ? outOfFocus(c, st === 'visited') : stateColor(c, st, x, y);
          if (edgeR || edgeD) c = border(c, regionEdge && this.mode === 'comuna');
        }
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  destroy() { this.ro.disconnect(); this.el.remove(); }
}

// ---------------------------------------------------------------------------
// "Pósters": la silueta del lugar (recortada del dibujo del mapa) como una isla
// ---------------------------------------------------------------------------
export const POSTER_SIZES = { small: [64, 96], large: [112, 168] };

/**
 * Dibuja la silueta del lugar como una isla en el mar.
 * @param {object[]} maps candidatos (el que contenga mejor el lugar)
 * @param {(type, code) => string|null} stateOf
 * @param {{size?: 'small'|'large', icons?: boolean}} [opts]
 *   icons: dibuja los íconos de las comunas visitadas.
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

  // Máscara de la silueta en coordenadas del póster: comuna y pixel de origen en el mapa.
  const mask = new Int32Array(PW * PH);
  const regionOf = new Int32Array(PW * PH);
  const srcOf = new Int32Array(PW * PH).fill(-1);
  const m = best?.m;
  if (best) {
    const { b } = best;
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
      if (!c) continue;
      const q = py * PW + px;
      mask[q] = c;
      regionOf[q] = m.region[j];
      srcOf[q] = j;
    }
  }

  const ocean = getPosterOcean();
  const dist = distanceField(PW, PH, (j) => mask[j] !== 0, (j) => mask[j] === 0, 5);
  const regionVisited = type === 'region' && stateOf('region', code) === 'visited';
  const put = (x, y, c) => { const o = (y * PW + x) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; };
  const at = (x, y) => (x < 0 || y < 0 || x >= PW || y >= PH ? 0 : mask[y * PW + x]);
  // ¿El vecino en el mapa original es tierra? (entonces el borde es un corte, no costa)
  const cutEdge = (q, dx, dy) => {
    const j = srcOf[q];
    const sx = (j % m.w) + dx, sy = Math.floor(j / m.w) + dy;
    return sx >= 0 && sy >= 0 && sx < m.w && sy < m.h && m.comuna[sy * m.w + sx] !== 0;
  };
  for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
    const q = y * PW + x;
    const c = mask[q];
    if (!c) {
      const d = dist[q];
      let col;
      if (d === 1) col = COLORS.foam;
      else if (d === 2) col = (x + y) % 2 ? COLORS.foam : COLORS.shallow;
      else if (d <= 4) col = COLORS.shallow;
      else if (d === 5) col = (x + y) % 2 ? COLORS.shallow : COLORS.shallow2;
      else if (ocean) { const o = ((y % ocean.height) * ocean.width + (x % ocean.width)) * 4; col = [ocean.data[o], ocean.data[o + 1], ocean.data[o + 2]]; }
      else col = COLORS.ocean;
      put(x, y, col);
      continue;
    }
    const o = srcOf[q] * 4;
    let col = [m.art[o], m.art[o + 1], m.art[o + 2]];
    const st = stateOf('comuna', c);
    col = type === 'region' && st !== 'visited' && regionVisited ? ((x + y) % 3 ? fogged(col) : col) : stateColor(col, st, x, y);
    const nR = at(x + 1, y), nD = at(x, y + 1);
    if ((nR && nR !== c) || (nD && nD !== c)) col = border(col);
    else if ((!nR && cutEdge(q, 1, 0)) || (!nD && cutEdge(q, 0, 1))) col = mix(col, BLACK, 0.22);
    else if ((!at(x - 1, y) && cutEdge(q, -1, 0)) || (!at(x, y - 1) && cutEdge(q, 0, -1))) col = mix(col, WHITE, 0.3);
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
