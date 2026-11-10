#!/usr/bin/env node
/**
 * Genera el arte inicial de los mapas en PNG (public/img/maps/<id>.png) y el
 * fondo de mar de las imágenes de cada lugar (public/img/poster-ocean.png).
 *
 * Los PNG son editables a mano (ver docs/ARTE.md). Por eso este script NO
 * sobrescribe archivos que ya existen, salvo con --force (o --force=<id>,…).
 * Hay que regenerarlos sólo si cambia la grilla de public/data/maps.json
 * (npm run build:geo), porque el tamaño del PNG debe calzar con ella.
 *
 * Uso:
 *   node scripts/build-art.mjs              # crea los que falten
 *   node scripts/build-art.mjs --force      # regenera todos (¡pisa ediciones!)
 *   node scripts/build-art.mjs --force=r13  # regenera sólo r13
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, pngSize } from './lib/png.mjs';
import { decodeMap, renderMapArt, renderPosterOcean } from './lib/mapart.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'img', 'maps');

const arg = process.argv.find((a) => a.startsWith('--force'));
const forceAll = arg === '--force';
const forceIds = arg && arg.includes('=') ? new Set(arg.split('=')[1].split(',')) : new Set();
const shouldWrite = (file, id) => forceAll || forceIds.has(id) || !fs.existsSync(file);

const mapsRaw = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'maps.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(PUB, 'data', 'catalog.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

let written = 0, kept = 0;
for (const id of Object.keys(mapsRaw.maps)) {
  const file = path.join(OUT, `${id}.png`);
  const m = mapsRaw.maps[id];
  if (!shouldWrite(file, id)) {
    const { w, h } = pngSize(fs.readFileSync(file));
    if (w !== m.w || h !== m.h) console.warn(`  ⚠ ${id}.png mide ${w}×${h} pero la grilla es ${m.w}×${m.h} (usa --force=${id})`);
    kept++;
    continue;
  }
  const map = decodeMap(id, mapsRaw, catalog);
  fs.writeFileSync(file, encodePNG(map.w, map.h, renderMapArt(map)));
  console.log(`  ${id}.png ${map.w}×${map.h}`);
  written++;
}

const ocean = path.join(PUB, 'img', 'poster-ocean.png');
if (shouldWrite(ocean, 'poster-ocean')) {
  fs.writeFileSync(ocean, encodePNG(112, 168, renderPosterOcean(112, 168)));
  console.log('  poster-ocean.png 112×168');
  written++;
} else kept++;

console.log(`Listo: ${written} generados, ${kept} existentes sin tocar.`);
