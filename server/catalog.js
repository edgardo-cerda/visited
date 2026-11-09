import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'catalog.json'), 'utf8'));

export const regions = raw.regions;
export const comunas = raw.comunas;
export const regionByCode = new Map(regions.map((r) => [r.code, r]));
export const comunaByCode = new Map(comunas.map((c) => [c.code, c]));
export const comunasByRegion = new Map(regions.map((r) => [r.code, comunas.filter((c) => c.region === r.code)]));

export const PLACE_TYPES = ['region', 'comuna'];

/** Devuelve el lugar (región o comuna) o null si no existe. */
export function findPlace(type, code) {
  const n = Number(code);
  if (!Number.isInteger(n)) return null;
  if (type === 'region') return regionByCode.get(n) || null;
  if (type === 'comuna') return comunaByCode.get(n) || null;
  return null;
}

/** Resumen corto de un lugar, para incrustar en respuestas (reseñas, feed…). */
export function placeSummary(type, code) {
  const p = findPlace(type, code);
  if (!p) return null;
  if (type === 'region') return { type, code: p.code, name: p.name, shortName: p.shortName, roman: p.roman };
  const r = regionByCode.get(p.region);
  return {
    type, code: p.code, name: p.name, province: p.province,
    region: { code: r.code, name: r.name, shortName: r.shortName, roman: r.roman },
  };
}

export const totalAreaKm2 = comunas.reduce((s, c) => s + (c.areaKm2 || 0), 0);
