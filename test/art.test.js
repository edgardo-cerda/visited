import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pngSize } from '../scripts/lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (...p) => path.join(ROOT, 'public', ...p);
const maps = JSON.parse(fs.readFileSync(pub('data', 'maps.json'), 'utf8')).maps;
const catalog = JSON.parse(fs.readFileSync(pub('data', 'catalog.json'), 'utf8'));
const lm = JSON.parse(fs.readFileSync(pub('img', 'landmarks.json'), 'utf8'));

test('cada mapa tiene su PNG y mide lo mismo que su grilla', () => {
  for (const [id, m] of Object.entries(maps)) {
    const file = pub('img', 'maps', `${id}.png`);
    assert.ok(fs.existsSync(file), `falta public/img/maps/${id}.png (npm run build:art)`);
    const { w, h } = pngSize(fs.readFileSync(file));
    assert.deepEqual({ w, h }, { w: m.w, h: m.h }, `${id}.png debe medir ${m.w}×${m.h}`);
  }
});

test('la hoja de íconos y landmarks.json son coherentes', () => {
  const { w, h } = pngSize(fs.readFileSync(pub('img', 'landmarks.png')));
  const ids = new Set();
  for (const s of lm.sprites) {
    assert.ok(!ids.has(s.id), `ícono repetido: ${s.id}`);
    ids.add(s.id);
    assert.ok(s.name, `el ícono ${s.id} no tiene nombre`);
    assert.ok((s.col + 1) * lm.tile <= w && (s.row + 1) * lm.tile <= h, `el ícono ${s.id} queda fuera de landmarks.png`);
  }
  const used = [
    ...Object.values(lm.byComuna).flat(),
    ...lm.groups.flatMap((g) => g.sprites),
    ...Object.values(lm.byRegion).flat(),
  ];
  for (const id of used) assert.ok(ids.has(id), `landmarks.json usa el ícono "${id}", que no existe en "sprites"`);

  const codes = new Set(catalog.comunas.map((c) => c.code));
  for (const code of [...Object.keys(lm.byComuna), ...lm.groups.flatMap((g) => g.comunas)]) {
    assert.ok(codes.has(Number(code)), `código de comuna desconocido en landmarks.json: ${code}`);
  }
  // Toda comuna tiene al menos un ícono (propio, de grupo o de su región).
  for (const c of catalog.comunas) {
    const own = lm.byComuna[c.code], group = lm.groups.find((g) => g.comunas.includes(c.code));
    assert.ok(own?.length || group?.sprites.length || lm.byRegion[c.region]?.length, `${c.name} no tiene ícono`);
  }
});
