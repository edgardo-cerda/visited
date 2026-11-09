/**
 * Mapa pixel art: dibuja una grilla (1 celda = 1 pixel) en un <canvas> y la
 * escala con `image-rendering: pixelated`. Cada celda pertenece a una comuna;
 * el color depende de si el lugar fue visitado, está en "Quiero ir", etc.
 */
import { mapIndex } from './store.js';

const C = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// Paletas: [luz, base, sombra]
export const PALETTE = {
  bg: C('#14181c'),
  bgDot: C('#1c2229'),
  frame: C('#7d8fa3'),
  other: C('#262d35'),
  none: [C('#55657a'), C('#445566'), C('#2f3b48')],
  visited: [C('#6dff9e'), C('#00e054'), C('#00a03c')],
  wishlist: [C('#9be0ff'), C('#40bcf4'), C('#2585b5')],
  hover: [C('#ffc078'), C('#ff8000'), C('#b85c00')],
  focus: [C('#ffd9a8'), C('#ffb347'), C('#d98a2b')],
  dim: [C('#2a333d'), C('#232b33'), C('#1d242b')],
  dimVisited: [C('#1f5a3a'), C('#1a4a31'), C('#153d29')],
};

export class PixelMap {
  /**
   * @param {object} opts
   * @param {object} opts.map            mapa decodificado (store.getMap)
   * @param {'comuna'|'region'} opts.mode agrupación de colores y clics
   * @param {(type, code) => string|null} opts.stateOf  'visited' | 'wishlist' | null
   * @param {number} [opts.focusRegion]  atenúa comunas de otras regiones
   * @param {number} [opts.highlight]    comuna/región resaltada (naranja)
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
      this.tip.style.left = `${Math.min(x + 14, r.width - this.tip.offsetWidth - 4)}px`;
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
    const { w, h, data, comuna, region, special } = this.map;
    const px = this.img.data;
    const groupOf = this.mode === 'region' ? region : comuna;
    const isLand = (j) => comuna[j] !== 0;
    const hoverCode = this.hover?.code;
    const stateCache = new Map();
    const paletteFor = (j) => {
      const g = groupOf[j];
      const key = g;
      let p = stateCache.get(key);
      if (p) return p;
      const inFocus = !this.focusRegion || region[j] === this.focusRegion;
      const st = this.stateOf ? this.stateOf(this.mode, g) : null;
      if (g === hoverCode) p = PALETTE.hover;
      else if (g === this.highlight) p = PALETTE.focus;
      else if (!inFocus) p = st === 'visited' ? PALETTE.dimVisited : PALETTE.dim;
      else p = st === 'visited' ? PALETTE.visited : st === 'wishlist' ? PALETTE.wishlist : PALETTE.none;
      stateCache.set(key, p);
      return p;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const j = y * w + x;
        const v = data[j];
        let c;
        if (v === special.empty) c = (x % 4 === 0 && y % 4 === 0) ? PALETTE.bgDot : PALETTE.bg;
        else if (v === special.frame) c = PALETTE.frame;
        else if (v === special.other) c = PALETTE.other;
        else {
          const p = paletteFor(j);
          const g = groupOf[j];
          const right = x + 1 < w ? j + 1 : -1, down = y + 1 < h ? j + w : -1;
          const left = x > 0 ? j - 1 : -1, up = y > 0 ? j - w : -1;
          const edgeOut = (n) => n < 0 || !isLand(n);
          if (edgeOut(right) || edgeOut(down) || (right >= 0 && groupOf[right] !== g) || (down >= 0 && groupOf[down] !== g)) c = p[2];
          else if (edgeOut(left) || edgeOut(up)) c = p[0];
          else c = p[1];
        }
        const o = j * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  destroy() { this.ro.disconnect(); this.el.remove(); }
}

// ---------------------------------------------------------------------------
// "Pósters": silueta pixel art de una comuna o región (estilo cartelera)
// ---------------------------------------------------------------------------
const POSTER_W = 40, POSTER_H = 60;

/**
 * Dibuja la silueta en un canvas de 40×60 px lógicos.
 * @param {object[]} maps candidatos (el primero que contenga bien el lugar)
 * @param {(type, code) => string|null} stateOf
 */
export function posterCanvas(type, code, maps, stateOf) {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  canvas.className = 'poster-canvas';
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(POSTER_W, POSTER_H);

  // Elegir el mapa con más pixeles para el lugar, sin que toque los bordes.
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

  // Fondo con trama
  for (let y = 0; y < POSTER_H; y++) for (let x = 0; x < POSTER_W; x++) {
    const o = (y * POSTER_W + x) * 4;
    const c = (x + y) % 6 === 0 ? [36, 44, 52] : [30, 37, 44];
    img.data.set([...c, 255], o);
  }

  if (best) {
    const { m, b } = best;
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const pad = 4;
    const k = Math.min((POSTER_W - pad * 2) / bw, (POSTER_H - pad * 2) / bh);
    const scale = k >= 1 ? Math.floor(k) : k;
    const ow = Math.round(bw * scale), oh = Math.round(bh * scale);
    const ox = Math.floor((POSTER_W - ow) / 2), oy = Math.floor((POSTER_H - oh) / 2);
    const inside = (sx, sy) => {
      if (sx < b.x0 || sy < b.y0 || sx > b.x1 || sy > b.y1) return 0;
      const j = sy * m.w + sx;
      if (type === 'region') {
        const inInset = m.insets.some((r) => sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h);
        return !inInset && m.region[j] === code ? m.comuna[j] : 0;
      }
      return m.comuna[j] === code ? code : 0;
    };
    const sample = (px, py) => inside(b.x0 + Math.floor((px - ox) / scale), b.y0 + Math.floor((py - oy) / scale));
    for (let py = oy; py < oy + oh; py++) for (let px = ox; px < ox + ow; px++) {
      const c = sample(px, py);
      if (!c) continue;
      const st = type === 'region' ? stateOf('comuna', c) : stateOf('comuna', code);
      const own = type === 'region' ? stateOf('region', code) : st;
      let pal;
      if (type === 'region') pal = st === 'visited' ? PALETTE.visited : own === 'visited' ? [C('#3c8f5c'), C('#2f7a4c'), C('#23603b')] : PALETTE.none;
      else pal = st === 'visited' ? PALETTE.visited : st === 'wishlist' ? PALETTE.wishlist : PALETTE.none;
      const edge = sample(px + 1, py) !== c || sample(px, py + 1) !== c;
      const light = !edge && (!sample(px - 1, py) || !sample(px, py - 1));
      img.data.set([...(edge ? pal[2] : light ? pal[0] : pal[1]), 255], (py * POSTER_W + px) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Avatar pixel (identicon simétrico 7×7 a partir del nombre de usuario)
// ---------------------------------------------------------------------------
export function avatarCanvas(seed) {
  let hsh = 2166136261;
  for (const ch of String(seed)) hsh = Math.imul(hsh ^ ch.codePointAt(0), 16777619) >>> 0;
  const rand = () => ((hsh = Math.imul(hsh ^ (hsh >>> 15), 2246822507) >>> 0), hsh / 4294967296);
  const colors = ['#00e054', '#ff8000', '#40bcf4', '#f4d03f', '#e056fd', '#ff6b6b'];
  const fg = colors[Math.floor(rand() * colors.length)];
  const N = 7;
  const canvas = document.createElement('canvas');
  canvas.width = N + 2;
  canvas.height = N + 2;
  canvas.className = 'avatar-canvas';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2c3440';
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
