# API REST · Visited Chile (v1)

La web usa esta misma API, así que una app móvil (React Native, Flutter, Swift, Kotlin…) puede ofrecer exactamente las mismas funciones.

- **Base:** `https://<tu-dominio>/api/v1`
- **Formato:** JSON (`Content-Type: application/json`)
- **Autenticación:** token Bearer → `Authorization: Bearer <token>`
- **CORS:** habilitado (configurable con `CORS_ORIGINS`). No se usan cookies.
- **Errores:** `{ "error": { "code": "bad_request", "message": "…", "field": "username" } }`
  con códigos HTTP 400, 401, 404, 409, 413, 429 o 500. `field` sólo aparece en errores de validación.

## Datos geográficos

| Recurso | Descripción |
|---|---|
| `GET /api/v1/catalog` | Las 16 regiones y 346 comunas (códigos CUT oficiales). |
| `GET /data/catalog.json` | Igual, como archivo estático (cacheable). |
| `GET /data/maps.json` | Grillas pixel art para dibujar los mapas (ver más abajo). |

```jsonc
// región
{ "code": 13, "roman": "RM", "name": "Metropolitana de Santiago", "shortName": "Metropolitana",
  "zone": "centro", "order": 7, "comunaCount": 52, "areaKm2": 15403 }
// comuna
{ "code": 13101, "name": "Santiago", "province": "Santiago", "region": 13, "areaKm2": 23.2 }
```

Los lugares se identifican siempre con `type` (`region` | `comuna`) + `code`.

## Autenticación

### `POST /auth/register`
```json
{ "username": "camila", "email": "camila@mail.cl", "password": "minimo-8", "displayName": "Camila" }
```
`username`: 3–20 caracteres `[A-Za-z0-9_]`. `displayName` es opcional.
→ `201 { "token": "…", "expiresAt": "…", "user": { "username", "displayName", "bio", "email", "createdAt" } }`

### `POST /auth/login`
```json
{ "login": "camila", "password": "minimo-8" }
```
`login` acepta usuario o email. → `200` igual que el registro.

### `POST /auth/logout` 🔒
Invalida el token actual. → `204`

Los tokens duran 60 días (`TOKEN_TTL_DAYS`). Guárdalo de forma segura en la app (Keychain / Keystore).

## Mi cuenta 🔒

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/me` | Mi usuario (incluye email). |
| `PATCH` | `/me` | `{ "displayName"?, "bio"? }` |
| `POST` | `/me/password` | `{ "currentPassword", "newPassword" }` → `204`. Cierra las demás sesiones. |
| `DELETE` | `/me` | `{ "password" }` → `204`. Borra la cuenta y todos sus registros. |
| `GET` | `/me/progress` | Nivel, XP, porcentajes, progreso por región y logros. |
| `GET` | `/me/logs?type=comuna` | Todos mis registros (filtro `type` opcional). |
| `GET` | `/me/logs/:type/:code` | Mi registro de un lugar (`log` puede ser `null`). |
| `PUT` | `/me/logs/:type/:code` | Crear/actualizar registro (ver abajo). |
| `DELETE` | `/me/logs/:type/:code` | Borrar registro. → `204` |
| `POST` | `/me/logs/batch` | Marcar/desmarcar varios: `{ "items": [{ "type", "code", "visited": true }] }` (máx. 400). |

### Registro (`log`)
```json
{
  "type": "comuna", "code": 5201,
  "visited": true, "wishlist": false, "liked": true,
  "rating": 5, "review": "Los moái al amanecer…", "visitedOn": "2024-02-10",
  "reviewAt": "2026-11-09T17:00:00.000Z", "createdAt": "…", "updatedAt": "…"
}
```

`PUT /me/logs/:type/:code` acepta cualquier subconjunto de
`visited` (bool), `wishlist` (bool), `liked` (bool), `rating` (entero 1–5 o `null`),
`review` (texto ≤ 5000 o `null`), `visitedOn` (`AAAA-MM-DD` o `null`). Reglas:

- Poner nota, reseña, fecha o "me gusta" marca el lugar como **visitado**.
- `visited: false` borra nota, reseña, fecha y "me gusta".
- `wishlist` ("Quiero ir") sólo aplica a lugares no visitados (`409` si ya está visitado). Visitar un lugar lo saca de "Quiero ir".
- Si nada queda marcado, el registro se elimina y la respuesta es `{ "log": null }`.
- **Regiones y comunas son independientes:** marcar una comuna no marca su región.

## Lugares y comunidad (públicos)

Si se envía un token, las respuestas pueden incluir datos propios (`myLog`).

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/places/:type/:code` | Lugar + estadísticas + 10 reseñas recientes + `myLog`. |
| `GET` | `/places/:type/:code/reviews?limit&offset` | Reseñas paginadas (`total`). |
| `GET` | `/stats/places?type=comuna` | Visitantes, notas y promedio de cada lugar con actividad. |
| `GET` | `/reviews?type&limit&offset` | Feed global de reseñas recientes. |
| `GET` | `/users?q=cami` | Buscar usuarios (mín. 2 caracteres). |
| `GET` | `/users/:username` | Perfil público + resumen (nivel, conteos). Nunca expone el email. |
| `GET` | `/users/:username/progress` | Progreso completo. |
| `GET` | `/users/:username/logs?type` | Registros públicos del usuario. |
| `GET` | `/users/:username/reviews?limit&offset` | Reseñas del usuario. |
| `GET` | `/health` | `{ "ok": true }` |

Estadísticas de un lugar:
```json
{ "visitors": 12, "wishlisted": 3, "likes": 5, "reviews": 4, "ratings": 9,
  "averageRating": 4.33, "histogram": [0, 0, 1, 4, 4] }
```

## Progreso y niveles

`computeProgress` vive en [`public/js/shared/progress.js`](../public/js/shared/progress.js) (JavaScript puro, sin dependencias) y lo usan tanto el servidor como la web; una app en JS/TS puede importarlo tal cual para dar feedback instantáneo.

XP: comuna visitada +10, región visitada +40, reseña +5, nota +1. Hay 10 niveles (de *Turista* a *Leyenda de la Ruta 5*) y 18 logros.

```jsonc
{
  "level": { "level": 5, "title": "Patiperro", "xp": 682, "levelXp": 500, "nextLevelXp": 800, "nextTitle": "Explorador", "progress": 0.61 },
  "regions": { "visited": 9, "total": 16, "percent": 56.3 },
  "comunas": { "visited": 31, "total": 346, "percent": 9 },
  "area": { "visitedKm2": 175000, "totalKm2": 756000, "percent": 23.2 },
  "counts": { "reviews": 2, "ratings": 2, "wishlist": 1, "liked": 1, "averageRating": 4.5 },
  "byRegion": [{ "code": 15, "roman": "XV", "shortName": "Arica y Parinacota", "regionVisited": true, "visitedComunas": 1, "totalComunas": 4, "percent": 25 }],
  "badges": [{ "id": "rapa-nui", "name": "Rapa Nui", "description": "Visita Isla de Pascua.", "earned": true, "current": 1, "target": 1 }]
}
```

## Mapas pixel art (`/data/maps.json`)

Cada mapa es una grilla donde 1 celda = 1 pixel, codificada con RLE:

```jsonc
{
  "special": { "empty": 0, "frame": 1, "other": 2, "first": 3 },
  "codes": [15101, 15102, …],          // valor v >= 3  →  comuna codes[v - 3]
  "maps": {
    "chile":    { "w": 212, "h": 221, "rle": [v, n, v, n, …], "labels": [...], "insets": [...] },
    "r13":      { … },                 // un mapa por región (r1 … r16)
    "santiago": { … }                  // zoom Gran Santiago
  }
}
```

Para decodificar: recorrer `rle` de a pares y repetir el valor `v` `n` veces (orden fila por fila). Luego pintar cada celda según el estado del lugar y escalar sin suavizado (`image-rendering: pixelated` en web, `FilterQuality.none` en Flutter, `.interpolation(.none)` en SwiftUI). Ver [`public/js/pixelmap.js`](../public/js/pixelmap.js) como referencia.
