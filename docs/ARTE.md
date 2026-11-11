# Cómo editar el arte (PNG)

Todo el pixel art de la web se lee de archivos PNG en `public/img/`. Puedes abrirlos y editarlos con cualquier editor de pixel art (Aseprite, Piskel, LibreSprite, GIMP…) y los cambios se ven al recargar la página.

Guarda siempre como **PNG sin suavizado** (sin antialiasing), en RGB/RGBA de 8 bits y **sin cambiar el tamaño** de la imagen.

## Íconos de las comunas

| Archivo | Qué es |
|---|---|
| `public/img/landmarks.png` | Hoja de sprites: una cuadrícula de **16×16 px** por ícono, con **fondo transparente**. Hoy son 8 columnas × 5 filas. |
| `public/img/landmarks.json` | Nombre de cada ícono, su posición en la hoja y qué ícono usa cada comuna. |

En el JSON:

- `sprites`: lista de íconos: `id`, `name` (lo que se muestra en "Descubriste"), `col` y `row` (columna y fila en la hoja, desde 0).
- `byComuna`: íconos propios de cada comuna (código CUT → lista de `id`, máximo 2 se dibujan). Ejemplo: `"5201": ["moai"]`.
- `groups`: grupos de comunas que comparten ícono (Gran Santiago → Metro, Chiloé → iglesias).
- `byRegion`: ícono típico de cada región, para las comunas sin ícono propio ni grupo.

**Para cambiar un dibujo**, edita su casilla en `landmarks.png`.

**Para agregar un ícono nuevo**:
1. Dibújalo en una casilla libre de `landmarks.png` (si no hay espacio, agranda la imagen hacia abajo en múltiplos de 16 px).
2. Agrégalo a `sprites` con su `id`, `name`, `col` y `row`.
3. Úsalo en `byComuna` (o `groups` / `byRegion`).

Los pixeles con transparencia menor a 50% no se dibujan. En la imagen grande de cada comuna los íconos se dibujan al doble de tamaño.

## Mapas (el país, las regiones y las comunas)

| Archivo | Qué es |
|---|---|
| `public/img/maps/chile.png` | Mapa del país (tres tramos + recuadros de Rapa Nui, Juan Fernández y Antártica). |
| `public/img/maps/r1.png` … `r16.png` | Mapa de cada región (el número es el código de región). |
| `public/img/maps/santiago.png` | Zoom del Gran Santiago. |
| `public/img/poster-ocean.png` | Fondo de mar de las imágenes de cada lugar. |

Cada mapa está dibujado **como se ve cuando todo está visitado** (todas las comunas en el mismo verde, `#2f9b74`): mar, costa, terreno, cordillera y nubes. La web, al mostrarlo:

- pasa a gris (con niebla) lo que no has visitado,
- trama lo que está en "Quiero ir",
- dibuja los bordes entre comunas o regiones y resalta el lugar bajo el mouse.

Así que basta con dibujar una sola versión. Las imágenes de cada comuna y región (las "islas") se recortan de estos mismos mapas: si cambias los colores de una comuna en `r5.png`, cambia también su imagen.

En `chile.png` los pixeles **transparentes** son "nada": la web muestra ahí el fondo de la página. Por eso el mar aparece sólo al oeste, en una franja junto a la costa, y al este de la cordillera no hay nada. Al norte de Arica se ve parte del Perú.

**Importante:** qué pixel pertenece a qué comuna no está en el PNG sino en `public/data/maps.json`. Puedes cambiar colores, texturas y detalles libremente, pero si pintas tierra donde la grilla dice "mar" (o al revés), ese pixel no será clickeable ni cambiará de color al visitar. El tamaño del PNG debe ser exactamente el de su grilla (`npm test` lo verifica).

## Ícono de la pestaña y logo

| Archivo | Qué es |
|---|---|
| `public/img/icono.svg` | Ícono de la pestaña (montaña con la bandera de Chile, 32×32). |
| `public/img/icono-32.png` | El mismo ícono en PNG, para navegadores sin soporte de SVG. |
| `public/img/icono-192.png` | El mismo ícono a 192×192, para la pantalla de inicio del celular. |

El logo de la barra superior es el mismo dibujo, incrustado en `public/index.html`. Los navegadores guardan el ícono en caché con mucha insistencia: si lo cambias y no se actualiza, guárdalo con otro nombre de archivo (y actualiza los `<link rel="icon">` de `index.html`).

## Regenerar desde cero

El arte inicial lo genera un script a partir de los límites geográficos:

```bash
npm run build:art
```

Sólo crea los PNG que falten; **no pisa los que ya existen**. Para volver a generar uno (perdiendo sus ediciones) usa `npm run build:art -- --force=r13`, o `-- --force` para todos.

Si cambias las grillas (`npm run build:geo`, por ejemplo para subir la resolución), los tamaños dejan de calzar y hay que regenerar los mapas con `--force`.
