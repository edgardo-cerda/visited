import { html, mount, $, el } from '../html.js';
import { api } from '../api.js';
import { store, me, getMap, stateIn, myProgress, placeName } from '../store.js';
import { PixelMap } from '../pixelmap.js';
import { icon, levelCard, poster, reviewCard, emptyState } from '../components.js';

export async function homeView(ctx) {
  document.title = 'Visited · Chile';
  const u = me();
  mount(ctx.root, html`
    ${u ? html`
      <section class="home-hello">
        <div class="home-hello-text">
          <p class="kicker">Hola de nuevo</p>
          <h1>${u.displayName}</h1>
          <div id="home-level"></div>
          <div class="cta-row">
            <a class="btn btn-primary" href="/u/${u.username}">Ver mi mapa</a>
            <a class="btn" href="/explorar">Marcar lugares</a>
          </div>
        </div>
        <div class="home-map" id="home-map"></div>
      </section>`
    : html`
      <section class="hero">
        <div class="hero-text">
          <p class="kicker">Tu bitácora de viajes por Chile</p>
          <h1>Pinta el mapa de Chile con los lugares que has recorrido.</h1>
          <p class="lead">Marca las <b>16 regiones</b> y <b>346 comunas</b> que has visitado, califícalas con estrellas (medias incluidas), escribe reseñas y sube de nivel hasta convertirte en una leyenda de la Ruta 5.</p>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href="/registro">Empieza gratis</a>
            <a class="btn btn-lg" href="/explorar">Explorar lugares</a>
          </div>
        </div>
        <div class="home-map" id="home-map"></div>
      </section>
      <section class="features">
        <div class="feature">${icon('eye')}<h3>Marca</h3><p>Registra regiones y comunas por separado. Tu progreso se guarda en tu cuenta.</p></div>
        <div class="feature">${icon('star')}<h3>Califica</h3><p>Ponle de ½ a 5 estrellas y escribe una reseña. Vota las reseñas de otros viajeros.</p></div>
        <div class="feature">${icon('map')}<h3>Descubre</h3><p>Tu mapa pixel art está cubierto de niebla y se despeja a medida que viajas.</p></div>
        <div class="feature">${icon('trophy')}<h3>Sube de nivel</h3><p>Gana XP, desbloquea logros y completa Chile entero.</p></div>
      </section>`}

    <section class="section">
      <div class="section-head"><h2>Más visitados</h2><a href="/explorar">Explorar todo</a></div>
      <div class="poster-row" id="popular">${''}</div>
    </section>

    <section class="section two-col">
      <div>
        <div class="section-head"><h2>Reseñas destacadas</h2><a href="/resenas">Ver más</a></div>
        <div id="recent-reviews"></div>
      </div>
      <aside>
        <div class="section-head"><h2>Mejor evaluados</h2></div>
        <ol class="toplist" id="top-rated"></ol>
      </aside>
    </section>
  `);

  // Mapa: propio (si hay sesión) o animación de demostración.
  const mapBox = $('#home-map');
  const chile = getMap('chile');
  if (u) {
    mount($('#home-level'), levelCard(myProgress()));
    const pm = new PixelMap({
      map: chile, mode: 'comuna',
      stateOf: (t, c) => stateIn(store.logs, t, c),
      label: (t, c) => placeName(t, c),
      onClick: (t, c) => ctx.navigate(`/${t}/${c}`),
      maxScale: 3,
    });
    mapBox.append(pm.el);
    ctx.on('logs', () => { pm.draw(); mount($('#home-level'), levelCard(myProgress())); });
    ctx.onCleanup(() => pm.destroy());
  } else {
    const lit = new Set();
    const codes = store.catalog.comunas.map((c) => c.code);
    const pm = new PixelMap({ map: chile, mode: 'comuna', stateOf: (_t, c) => (lit.has(c) ? 'visited' : null), maxScale: 3 });
    mapBox.append(pm.el);
    const timer = setInterval(() => {
      if (lit.size > 140) lit.clear();
      for (let i = 0; i < 4; i++) lit.add(codes[Math.floor(Math.random() * codes.length)]);
      pm.draw();
    }, 260);
    ctx.onCleanup(() => { clearInterval(timer); pm.destroy(); });
  }

  // Datos de la comunidad
  const [stats, reviews] = await Promise.all([
    api('/stats/places?type=comuna').catch(() => ({ places: [] })),
    api('/reviews?sort=top&limit=6').catch(() => ({ reviews: [] })),
  ]);
  const popular = [...stats.places].sort((a, b) => b.visitors - a.visitors || (b.averageRating || 0) - (a.averageRating || 0)).slice(0, 8);
  const popBox = $('#popular');
  if (!popBox) return;
  const fallback = [13101, 5101, 5109, 15101, 2203, 5201, 12101, 10202];
  for (const p of popular.length >= 4 ? popular : fallback.map((code) => ({ code, visitors: 0 }))) {
    popBox.append(poster('comuna', p.code, { quick: true, sub: p.visitors ? `${p.visitors} viajero${p.visitors === 1 ? '' : 's'}` : null }));
  }
  ctx.on('logs', () => {
    for (const n of [...popBox.children]) n.replaceWith(poster('comuna', Number(n.dataset.code), { quick: true, sub: n.querySelector('.poster-sub')?.textContent }));
  });

  const rr = $('#recent-reviews');
  if (reviews.reviews.length) for (const r of reviews.reviews) rr.append(reviewCard(r));
  else mount(rr, emptyState('Todavía no hay reseñas. ¡Escribe la primera!'));

  const top = stats.places.filter((p) => p.ratings > 0).sort((a, b) => b.averageRating - a.averageRating || b.ratings - a.ratings).slice(0, 10);
  const tl = $('#top-rated');
  if (top.length) {
    mount(tl, top.map((p) => html`<li><a href="/comuna/${p.code}">${placeName('comuna', p.code)}</a><span class="muted">${p.averageRating.toFixed(1)} ★ · ${p.ratings}</span></li>`));
  } else {
    tl.replaceWith(el(html`<p class="muted">Aún no hay evaluaciones.</p>`));
  }
}
