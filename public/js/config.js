/**
 * Configuración de despliegue. En el servidor normal no se define nada.
 * En GitHub Pages, scripts/build-pages.mjs inyecta:
 *   window.VISITED_CONFIG = { base: '/visited', demo: true }
 */
const cfg = window.VISITED_CONFIG || {};

/** Prefijo de la URL donde vive la web (p. ej. "/visited" en GitHub Pages). */
export const BASE = (cfg.base || '').replace(/\/+$/, '');

/** Modo demo: sin servidor, los datos se guardan en el navegador (localStorage). */
export const DEMO = !!cfg.demo;

/** Convierte una ruta interna ("/explorar") en URL real ("/visited/explorar"). */
export const url = (path) => BASE + path;

/** Ruta interna actual, sin el prefijo BASE. */
export function appPath() {
  let p = location.pathname;
  if (BASE && (p === BASE || p.startsWith(`${BASE}/`))) p = p.slice(BASE.length);
  return p.replace(/\/+$/, '') || '/';
}

/** Quita el prefijo BASE de un href interno. */
export function stripBase(href) {
  if (BASE && (href === BASE || href.startsWith(`${BASE}/`) || href.startsWith(`${BASE}?`))) return href.slice(BASE.length) || '/';
  return href;
}
