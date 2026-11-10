/**
 * Íconos pixel art representativos de cada comuna. Aparecen sobre la silueta
 * del lugar cuando lo marcas como visitado.
 *
 * Se leen de dos archivos editables (ver docs/ARTE.md):
 *   public/img/landmarks.png   hoja de sprites (cuadrícula de 16×16, fondo transparente)
 *   public/img/landmarks.json  nombre de cada ícono y qué ícono usa cada comuna
 */
import { url } from './config.js';
import { loadImageData } from './png.js';

/** Sprites cargados: { id, name, w, h, px: [[x, y, [r, g, b]], …] } */
export const SPRITES = {};
let rules = { byComuna: {}, groups: [], byRegion: {} };

export async function loadLandmarks() {
  const [conf, sheet] = await Promise.all([
    fetch(url('/img/landmarks.json')).then((r) => r.json()),
    loadImageData(url('/img/landmarks.png')),
  ]);
  const T = conf.tile;
  for (const s of conf.sprites) {
    const px = [];
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const sx = s.col * T + x, sy = s.row * T + y;
      if (sx >= sheet.width || sy >= sheet.height) continue;
      const o = (sy * sheet.width + sx) * 4;
      if (sheet.data[o + 3] < 128) continue; // transparente
      px.push([x, y, [sheet.data[o], sheet.data[o + 1], sheet.data[o + 2]]]);
    }
    SPRITES[s.id] = { id: s.id, name: s.name, w: T, h: T, px };
  }
  rules = { byComuna: conf.byComuna || {}, groups: conf.groups || [], byRegion: conf.byRegion || {} };
}

const pick = (ids) => (ids || []).map((id) => SPRITES[id]).filter(Boolean);

/** Íconos de una comuna (siempre al menos uno si hay ícono de zona). `own`: íconos propios. */
export function landmarksFor(comuna) {
  const own = pick(rules.byComuna[comuna.code]);
  if (own.length) return { own: true, sprites: own };
  const group = rules.groups.find((g) => g.comunas.includes(comuna.code));
  return { own: false, sprites: pick(group ? group.sprites : rules.byRegion[comuna.region]) };
}

/** Dibuja un sprite (con sombra) sobre un ImageData, opcionalmente agrandado. */
export function drawSprite(img, sprite, ox, oy, { shadow = true, scale = 1 } = {}) {
  const { width: W, height: H, data } = img;
  const k = scale;
  const set = (x, y, c, a) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    for (let i = 0; i < 3; i++) data[o + i] = Math.round(data[o + i] * (1 - a) + c[i] * a);
    data[o + 3] = 255;
  };
  const block = (x, y, c, a, d = 0) => {
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) set(ox + x * k + dx + d, oy + y * k + dy + d, c, a);
  };
  if (shadow) for (const [x, y] of sprite.px) block(x, y, [20, 16, 30], 0.35, k);
  for (const [x, y, c] of sprite.px) block(x, y, c, 1);
}

/** Miniatura del sprite como canvas (para listas). */
export function spriteCanvas(sprite) {
  const c = document.createElement('canvas');
  c.width = sprite.w + 2;
  c.height = sprite.h + 2;
  c.className = 'sprite-canvas';
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  drawSprite(img, sprite, 1, 1, { shadow: false });
  ctx.putImageData(img, 0, 0);
  return c;
}
