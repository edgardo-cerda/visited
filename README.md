# Visited · Chile

Una bitácora de viajes estilo Letterboxd, pero con **las 16 regiones y 346 comunas de Chile** en vez de películas.

- Crea tu cuenta y marca los lugares que has visitado (regiones y comunas **por separado**).
- Ponles nota de **1 a 5 estrellas**, escribe reseñas, márcalos con ❤ o agrégalos a **"Quiero ir"**.
- Descubre tu **mapa pixel art** de Chile: lo que no has visitado está bajo la niebla y se despeja con cada viaje (modo regiones o comunas). Mar, desierto, valles, bosques, los Andes y nubes sobre los países vecinos; recuadros para Rapa Nui, Juan Fernández y la Antártica, y un zoom del Gran Santiago.
- Sube de **nivel** (XP), revisa tu progreso por región y desbloquea **logros**.
- Perfiles públicos, páginas de cada lugar con promedio, histograma y reseñas de la comunidad.

## Requisitos

- Node.js **22.13 o superior** (usa `node:sqlite`, incluido en Node; no hay dependencias nativas).

## Uso

```bash
npm install
```

```bash
npm start
```

Abre <http://localhost:3000>. La base de datos se crea sola en `data/visited.db`.

```bash
npm test
```

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP. |
| `DB_PATH` | `data/visited.db` | Archivo SQLite. |
| `TOKEN_TTL_DAYS` | `60` | Duración de las sesiones. |
| `CORS_ORIGINS` | `*` | Orígenes permitidos (separados por coma). |
| `TRUST_PROXY` | — | Ponlo en `1` si corre detrás de un proxy (Nginx, Render, Fly…). |
| `AUTH_RATE_LIMIT` | `30` | Intentos de login/registro por IP cada 15 min. |

## Versión de prueba en GitHub Pages

GitHub Pages sólo sirve archivos estáticos, así que ahí se publica una **versión de prueba** sin servidor: la API corre dentro del navegador (`public/js/demo-api.js`, con las mismas reglas que la real) y las cuentas, visitas y reseñas se guardan en el `localStorage` de cada visitante. No se comparten entre personas ni dispositivos.

Para activarla (una sola vez): en GitHub, **Settings → Pages → Build and deployment → Source: GitHub Actions**. Luego el workflow `.github/workflows/pages.yml` la publica en cada push a la rama principal, en `https://<usuario>.github.io/<repo>/`.

Para generarla localmente:

```bash
PAGES_BASE=/visited node scripts/build-pages.mjs
```

## Integración con una app

Todo pasa por una **API REST JSON** versionada (`/api/v1`) con tokens Bearer, sin cookies y con CORS, de modo que una app móvil puede usarla directamente. Documentación completa en **[docs/API.md](docs/API.md)**.

Además, la app puede reutilizar:

- `public/data/catalog.json`: catálogo de regiones y comunas con códigos CUT.
- `public/data/maps.json`: las grillas del mapa pixel art (formato RLE simple).
- `public/js/shared/progress.js`: cálculo de nivel, XP y logros (JS puro).

## Estructura

```
server/            API (Express 5 + SQLite)
  routes/          auth, me (registros, progreso), public (lugares, reseñas, perfiles)
public/            Web (SPA en JavaScript sin build)
  js/views/        páginas: inicio, explorar, lugar, perfil, reseñas, ajustes
  js/pixelmap.js   render del mapa pixel art, pósters y avatares
  data/            catálogo y mapas generados
scripts/build-geo.mjs   genera public/data a partir de los límites oficiales
test/              pruebas de la API (node:test)
docs/API.md        referencia de la API
```

## Datos geográficos

Los mapas se generan con `npm run build:geo` (ya vienen generados en el repo). El script descarga los límites comunales de la **Biblioteca del Congreso Nacional** (vía [caracena/chile-geojson](https://github.com/caracena/chile-geojson)) y la Antártica de **Natural Earth**, y los rasteriza en grillas de pixeles:

- Mapa nacional en tres tramos (Norte, Centro, Sur) + recuadros insulares y antártico.
- Un mapa por región (las comunas vecinas aparecen atenuadas).
- Zoom del Gran Santiago, donde las comunas son muy pequeñas.

La comuna de Antártica no viene en la fuente y se agrega a mano (no suma superficie al "% del territorio").
