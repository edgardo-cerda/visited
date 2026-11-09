import { html, mount, $, $$, fmtNum, fmtDate } from '../html.js';
import { api } from '../api.js';
import { store, me, getMap, getLog, stateIn, placeName, saveLog, myProgress } from '../store.js';
import { PixelMap, posterCanvas } from '../pixelmap.js';
import {
  icon, stars, starInput, fmtRating, mapsFor, poster, reviewCard, openLogEditor, quickToggle, toast, levelUpCheck,
  bar, emptyState, confirmDialog,
} from '../components.js';

export async function placeView(ctx, type, code) {
  const place = type === 'region' ? store.catalog.regionByCode.get(code) : store.catalog.comunaByCode.get(code);
  if (!place) throw new Error('Este lugar no existe.');
  const region = type === 'region' ? place : store.catalog.regionByCode.get(place.region);
  document.title = `${place.name} · Visited Chile`;

  const data = await api(`/places/${type}/${code}`);
  const { stats } = data;

  mount(ctx.root, html`
    <section class="place">
      <div class="place-poster" id="place-poster"></div>
      <div class="place-main">
        <p class="kicker">${type === 'region' ? html`Región ${place.roman}` : html`Comuna · Provincia de ${place.province}`}</p>
        <h1>${place.name}</h1>
        ${type === 'comuna' ? html`<p class="place-sub">en la <a href="/region/${region.code}">Región ${region.name === 'Metropolitana de Santiago' ? 'Metropolitana' : `de ${region.name}`}</a></p>` : ''}
        <ul class="facts">
          ${place.areaKm2 ? html`<li><b>${fmtNum(Math.round(place.areaKm2))}</b> km²</li>` : html`<li>Territorio Chileno Antártico</li>`}
          ${type === 'region' ? html`<li><b>${place.comunaCount}</b> comunas</li>` : ''}
          <li><b>${stats.visitors}</b> ${stats.visitors === 1 ? 'viajero' : 'viajeros'}</li>
          <li><b>${stats.wishlisted}</b> quieren ir</li>
        </ul>
        <div class="ratings">
          <div class="ratings-head"><span class="section-label">Evaluaciones</span><span class="muted">${stats.ratings} ${stats.ratings === 1 ? 'nota' : 'notas'}</span></div>
          <div class="ratings-body">
            <div class="histogram">
              ${stats.histogram.map((n, i) => {
                const max = Math.max(1, ...stats.histogram);
                const v = (i + 1) / 2;
                return html`<div class="hbar" title="${n} × ${fmtRating(v)} estrella${v > 1 ? 's' : ''}"><span style="height:${Math.max(2, (n / max) * 100)}%"></span></div>`;
              })}
            </div>
            <div class="avg">${stats.averageRating ? html`<b>${fmtRating(stats.averageRating.toFixed(1))}</b>${stars(Math.round(stats.averageRating * 2) / 2, 'tiny')}` : html`<span class="muted">Sin notas</span>`}</div>
          </div>
        </div>
      </div>
      <aside class="place-actions card" id="place-actions"></aside>
    </section>

    ${type === 'region' ? html`
      <section class="section">
        <div class="section-head"><h2>Comunas de ${place.shortName}</h2><span id="region-progress" class="muted"></span></div>
        <div class="map-toolbar">
          ${me() ? html`<label class="switch"><input type="checkbox" id="mark-mode"><span></span> Marcar con clic</label>` : ''}
          <span class="legend"><i class="lg-visited"></i>Visitada <i class="lg-wish"></i>Quiero ir <i class="lg-none"></i>Sin explorar (niebla)</span>
        </div>
        <div class="region-maps">
          <div class="map-frame" id="region-map"></div>
          ${code === 13 ? html`<div class="map-frame"><p class="section-label">Zoom Gran Santiago</p><div id="santiago-map"></div></div>` : ''}
        </div>
        <div class="poster-grid" id="region-comunas"></div>
      </section>` : html`
      <section class="section">
        <div class="section-head"><h2>Ubicación</h2><a href="/region/${region.code}">Ver comunas de ${region.shortName}</a></div>
        <div class="map-frame map-small" id="region-map"></div>
      </section>`}

    <section class="section">
      <div class="section-head"><h2>Reseñas <small class="muted">${stats.reviews}</small></h2>
        <div class="seg seg-sm" id="review-sort"><button type="button" data-sort="top" class="on">Más votadas</button><button type="button" data-sort="recent">Recientes</button></div></div>
      <div id="place-reviews"></div>
      <button class="btn" id="more-reviews" ${stats.reviews > data.reviews.length ? '' : 'hidden'}>Cargar más</button>
    </section>`);

  // Póster grande
  const posterBox = $('#place-poster');
  const paintPoster = () => posterBox.replaceChildren(posterCanvas(type, code, mapsFor(type, code), (t, c) => stateIn(store.logs, t, c)));
  paintPoster();

  // Panel de acciones
  const actions = $('#place-actions');
  const paintActions = () => {
    // Si el foco estaba en las estrellas, se devuelve después de redibujar (teclado).
    const starsFocused = !!document.activeElement?.closest?.('#my-stars');
    queueMicrotask(() => { if (starsFocused) $('#my-stars .star-input')?.focus(); });
    if (!me()) {
      mount(actions, html`<p>Ingresa para registrar tus visitas, poner notas y escribir reseñas.</p>
        <a class="btn btn-primary btn-block" href="/ingresar?next=/${type}/${code}">Ingresar</a>
        <a class="btn btn-block" href="/registro">Crear cuenta</a>`);
      return;
    }
    const log = getLog(type, code) || {};
    mount(actions, html`
      <div class="action-row">
        <button type="button" class="action ${log.visited ? 'on a-visited' : ''}" data-act="visited">${icon('eye')}<span>${log.visited ? 'Visitado' : 'Visitar'}</span></button>
        <button type="button" class="action ${log.wishlist ? 'on a-wish' : ''}" data-act="wishlist" ${log.visited ? 'disabled title="Ya lo visitaste"' : ''}>${icon('clock')}<span>Quiero ir</span></button>
      </div>
      <div class="action-rating"><span class="section-label">${log.rating ? 'Tu nota' : 'Evalúa'}</span><span id="my-stars"></span></div>
      ${log.visitedOn ? html`<p class="muted center">Visitado el ${fmtDate(log.visitedOn)}</p>` : ''}
      <button type="button" class="btn btn-block" data-act="editor">${icon('pen')} ${log.review ? 'Editar reseña' : 'Registrar o reseñar…'}</button>
      ${type === 'region' && !log.visited && myProgress().byRegion.find((r) => r.code === code)?.visitedComunas > 0
        ? html`<p class="hint">Visitaste comunas de esta región pero aún no marcas la región.</p>` : ''}
    `);
    $('#my-stars', actions).append(starInput(log.rating, async (v) => {
      try {
        const { before, after } = await saveLog(type, code, { rating: v });
        toast(v ? `Nota guardada: ${fmtRating(v)} ★` : 'Nota borrada', 'ok');
        levelUpCheck(before, after);
      } catch (e) { toast(e.message, 'error'); }
    }));
    actions.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.act === 'editor') openLogEditor(type, code);
      else quickToggle(type, code, b.dataset.act);
    }));
  };
  paintActions();

  // Mapas
  const maps = [];
  const label = (t, c) => {
    const st = stateIn(store.logs, t, c);
    return `${placeName(t, c)}${st === 'visited' ? ' ✓' : st === 'wishlist' ? ' ⏲' : ''}`;
  };
  if (type === 'region') {
    let markMode = false;
    const onClick = async (t, c) => {
      if (markMode) await quickToggle(t, c, 'visited');
      else ctx.navigate(`/${t}/${c}`);
    };
    const pm = new PixelMap({ map: getMap(`r${code}`), mode: 'comuna', focusRegion: code, stateOf: (t, c) => stateIn(store.logs, t, c), label, onClick, maxScale: 6 });
    $('#region-map').append(pm.el);
    maps.push(pm);
    if (code === 13) {
      const sm = new PixelMap({ map: getMap('santiago'), mode: 'comuna', focusRegion: 13, stateOf: (t, c) => stateIn(store.logs, t, c), label, onClick, maxScale: 5 });
      $('#santiago-map').append(sm.el);
      maps.push(sm);
    }
    $('#mark-mode')?.addEventListener('change', (e) => {
      markMode = e.target.checked;
      if (markMode) toast('Modo marcar: haz clic en una comuna para marcarla o desmarcarla.', 'info', 3500);
    });

    const grid = $('#region-comunas');
    const paintGrid = () => {
      const cs = store.catalog.comunasByRegion.get(code);
      grid.replaceChildren(...cs.map((c) => poster('comuna', c.code, { quick: true, sub: c.province })));
      const v = cs.filter((c) => stateIn(store.logs, 'comuna', c.code) === 'visited').length;
      if (me()) mount($('#region-progress'), html`${v}/${cs.length} comunas visitadas ${bar(v / cs.length, 'small inline')}`);
    };
    paintGrid();
    ctx.on('logs', paintGrid);
  } else {
    const pm = new PixelMap({
      map: getMap(`r${region.code}`), mode: 'comuna', focusRegion: region.code, highlight: code,
      stateOf: (t, c) => stateIn(store.logs, t, c), label, onClick: (t, c) => ctx.navigate(`/${t}/${c}`), maxScale: 4,
    });
    $('#region-map').append(pm.el);
    maps.push(pm);
  }
  ctx.onCleanup(() => maps.forEach((m) => m.destroy()));

  ctx.on('logs', (e) => {
    maps.forEach((m) => m.draw());
    paintPoster();
    if (!e || (e.type === type && e.code === code)) paintActions();
    if (e && e.type === type && e.code === code) refreshReviews();
  });

  // Reseñas
  const list = $('#place-reviews');
  let offset = 0;
  const renderReviews = (reviews, append = false) => {
    if (!append) list.replaceChildren();
    if (!reviews.length && !append) mount(list, emptyState('Nadie ha reseñado este lugar todavía.'));
    for (const r of reviews) {
      const card = reviewCard(r, { showPlace: false });
      if (me() && r.user.username === me().username) {
        card.classList.add('mine');
        const tools = document.createElement('div');
        tools.className = 'review-tools';
        mount(tools, html`<button class="btn btn-sm" data-t="edit">Editar</button><button class="btn btn-sm btn-ghost" data-t="del">Borrar reseña</button>`);
        tools.addEventListener('click', async (ev) => {
          const t = ev.target.closest('[data-t]')?.dataset.t;
          if (t === 'edit') openLogEditor(type, code);
          if (t === 'del' && (await confirmDialog('¿Borrar tu reseña? Tu visita y tu nota se mantienen.'))) {
            await saveLog(type, code, { review: null });
            toast('Reseña borrada');
          }
        });
        card.querySelector('.review-body').append(tools);
      }
      list.append(card);
    }
    offset += reviews.length;
  };
  renderReviews(data.reviews);
  const more = $('#more-reviews');
  let sort = 'top';
  $('#review-sort').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b || b.dataset.sort === sort) return;
    sort = b.dataset.sort;
    $$('#review-sort button').forEach((x) => x.classList.toggle('on', x === b));
    offset = 0;
    refreshReviews();
  });
  async function refreshReviews() {
    const r = await api(`/places/${type}/${code}/reviews?sort=${sort}&limit=${Math.max(10, offset)}`);
    offset = 0;
    renderReviews(r.reviews);
    more.hidden = offset >= r.total;
  }
  more.addEventListener('click', async () => {
    const r = await api(`/places/${type}/${code}/reviews?sort=${sort}&limit=20&offset=${offset}`);
    renderReviews(r.reviews, true);
    more.hidden = offset >= r.total;
  });
}
