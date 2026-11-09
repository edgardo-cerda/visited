/**
 * Cálculo de progreso, nivel y logros. Módulo puro (sin dependencias) que se
 * usa tanto en el servidor (endpoint /progress) como en el navegador, para
 * dar feedback instantáneo al marcar lugares.
 */

export const XP = { comuna: 10, region: 40, review: 5, rating: 1 };

export const LEVELS = [
  { level: 1, xp: 0, title: 'Turista' },
  { level: 2, xp: 50, title: 'Paseador de domingo' },
  { level: 3, xp: 150, title: 'Mochilero' },
  { level: 4, xp: 300, title: 'Viajero frecuente' },
  { level: 5, xp: 500, title: 'Patiperro' },
  { level: 6, xp: 800, title: 'Explorador' },
  { level: 7, xp: 1200, title: 'Baqueano' },
  { level: 8, xp: 1700, title: 'Trotamundos' },
  { level: 9, xp: 2400, title: 'Cartógrafo' },
  { level: 10, xp: 3300, title: 'Leyenda de la Ruta 5' },
];

const ZONES = [
  { id: 'norte-grande', name: 'Norte Grande', of: 'del Norte Grande', regions: [15, 1, 2] },
  { id: 'norte-chico', name: 'Norte Chico', of: 'del Norte Chico', regions: [3, 4] },
  { id: 'centro', name: 'Zona Central', of: 'de la Zona Central', regions: [5, 13, 6, 7] },
  { id: 'centro-sur', name: 'Zona Centro-Sur', of: 'de la Zona Centro-Sur', regions: [16, 8, 9] },
  { id: 'sur', name: 'Zona Sur', of: 'de la Zona Sur', regions: [14, 10] },
  { id: 'austral', name: 'Zona Austral', of: 'de la Zona Austral', regions: [11, 12] },
];

export function levelFor(xp) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.xp) cur = l;
  const next = LEVELS.find((l) => l.level === cur.level + 1) || null;
  return {
    level: cur.level,
    title: cur.title,
    xp,
    levelXp: cur.xp,
    nextLevelXp: next ? next.xp : null,
    nextTitle: next ? next.title : null,
    progress: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1,
  };
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/**
 * @param {{regions: object[], comunas: object[]}} catalog
 * @param {{type: 'region'|'comuna', code: number, visited: boolean, rating?: number|null, review?: string|null}[]} logs
 */
export function computeProgress(catalog, logs) {
  const visitedRegions = new Set();
  const visitedComunas = new Set();
  let reviews = 0, ratings = 0, ratingSum = 0, wishlist = 0, liked = 0;
  for (const l of logs) {
    if (l.visited) (l.type === 'region' ? visitedRegions : visitedComunas).add(l.code);
    if (l.review) reviews++;
    if (l.rating) { ratings++; ratingSum += l.rating; }
    if (l.wishlist) wishlist++;
    if (l.liked) liked++;
  }

  const totalArea = catalog.comunas.reduce((s, c) => s + (c.areaKm2 || 0), 0);
  const visitedArea = catalog.comunas.reduce((s, c) => s + (visitedComunas.has(c.code) ? c.areaKm2 || 0 : 0), 0);

  const byRegion = catalog.regions.map((r) => {
    const cs = catalog.comunas.filter((c) => c.region === r.code);
    const v = cs.filter((c) => visitedComunas.has(c.code)).length;
    return {
      code: r.code, roman: r.roman, name: r.name, shortName: r.shortName,
      regionVisited: visitedRegions.has(r.code),
      visitedComunas: v, totalComunas: cs.length, percent: pct(v, cs.length),
    };
  });

  const xp = visitedComunas.size * XP.comuna + visitedRegions.size * XP.region + reviews * XP.review + ratings * XP.rating;

  const hasC = (code) => visitedComunas.has(code);
  const completeRegions = byRegion.filter((r) => r.visitedComunas === r.totalComunas);
  const badge = (id, name, description, current, target) => ({
    id, name, description, earned: current >= target, current: Math.min(current, target), target,
  });
  const badges = [
    badge('primer-paso', 'Primer paso', 'Marca tu primera comuna visitada.', visitedComunas.size, 1),
    ...ZONES.map((z) =>
      badge(`zona-${z.id}`, z.name, `Visita todas las regiones ${z.of}.`, z.regions.filter((c) => visitedRegions.has(c)).length, z.regions.length),
    ),
    badge('las-16', 'Las 16 regiones', 'Visita todas las regiones de Chile.', visitedRegions.size, catalog.regions.length),
    badge('arica-punta-arenas', 'De Arica a Punta Arenas', 'Visita Arica y Punta Arenas.', [15101, 12101].filter(hasC).length, 2),
    badge('rapa-nui', 'Rapa Nui', 'Visita Isla de Pascua.', hasC(5201) ? 1 : 0, 1),
    badge('robinson', 'Robinson Crusoe', 'Visita el archipiélago de Juan Fernández.', hasC(5104) ? 1 : 0, 1),
    badge('fin-del-mundo', 'Fin del mundo', 'Visita Cabo de Hornos.', hasC(12201) ? 1 : 0, 1),
    badge('antartica', 'Continente blanco', 'Visita la comuna de Antártica.', hasC(12202) ? 1 : 0, 1),
    badge('santiago-entero', 'Santiago entero', 'Visita las 52 comunas de la Región Metropolitana.',
      byRegion.find((r) => r.code === 13)?.visitedComunas || 0, 52),
    badge('region-completa', 'Región completa', 'Visita todas las comunas de una región.', completeRegions.length, 1),
    badge('critico', 'Crítico de viajes', 'Escribe 10 reseñas.', reviews, 10),
    badge('cien-comunas', '100 comunas', 'Visita 100 comunas.', visitedComunas.size, 100),
    badge('chile-entero', 'Chile entero', 'Visita las 346 comunas.', visitedComunas.size, catalog.comunas.length),
  ];

  return {
    level: levelFor(xp),
    regions: { visited: visitedRegions.size, total: catalog.regions.length, percent: pct(visitedRegions.size, catalog.regions.length) },
    comunas: { visited: visitedComunas.size, total: catalog.comunas.length, percent: pct(visitedComunas.size, catalog.comunas.length) },
    area: { visitedKm2: Math.round(visitedArea), totalKm2: Math.round(totalArea), percent: pct(visitedArea, totalArea) },
    counts: { reviews, ratings, wishlist, liked, averageRating: ratings ? Math.round((ratingSum / ratings) * 100) / 100 : null },
    byRegion,
    badges,
  };
}
