#!/usr/bin/env node
/**
 * Genera la versión de prueba estática para GitHub Pages en dist/.
 * No necesita servidor: la API corre en el navegador (public/js/demo-api.js)
 * y guarda los datos en localStorage.
 *
 * Uso:  PAGES_BASE=/visited node scripts/build-pages.mjs
 *   PAGES_BASE es la ruta donde se publica el sitio
 *   (https://<usuario>.github.io/<repo> -> "/<repo>"; dominio propio -> "").
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');
const base = (process.env.PAGES_BASE ?? '/visited').replace(/\/+$/, '');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
// Rutas absolutas de la página (/css, /js, /img…) -> bajo el prefijo del sitio.
html = html.replace(/(href|src)="\/(?!\/)/g, (_, attr) => `${attr}="${base}/`);
const config = `<script>window.VISITED_CONFIG = ${JSON.stringify({ base, demo: true })};</script>\n  `;
html = html.replace('<script type="module"', `${config}<script type="module"`);
html = html.replace('<title>Visited · Chile</title>', '<title>Visited · Chile (versión de prueba)</title>');

fs.writeFileSync(path.join(OUT, 'index.html'), html);
// GitHub Pages responde 404.html para rutas desconocidas (/u/usuario, /comuna/13101…):
// al ser la misma app, el enrutador del navegador muestra la página correcta.
fs.writeFileSync(path.join(OUT, '404.html'), html);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`Sitio estático generado en dist/ (base "${base || '/'}")`);
