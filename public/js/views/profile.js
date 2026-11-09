import { html, mount, $, fmtDate } from '../html.js';
import { api } from '../api.js';
import { store, me, getMap, stateIn, logsToMap, placeName } from '../store.js';
import { computeProgress } from '../shared/progress.js';
import { PixelMap } from '../pixelmap.js';
import { url } from '../config.js';
import {
  avatar, levelCard, regionProgressList, badgesGrid, poster, reviewCard, emptyState, quickToggle, toast, icon,
} from '../components.js';

const TABS = [
  ['', 'Mapa'],
  ['comunas', 'Comunas'],
  ['regiones', 'Regiones'],
  ['resenas', 'Reseñas'],
  ['quiero-ir', 'Quiero ir'],
  ['logros', 'Logros'],
];

export async function profileView(ctx, username, tab = '') {
  if (!TABS.some(([t]) => t === tab)) tab = '';
  const own = me()?.username.toLowerCase() === username.toLowerCase();
  const { user } = await api(`/users/${encodeURIComponent(username)}`);
  document.title = `${user.displayName} (@${user.username}) · Visited Chile`;

  let logs = own ? store.logs : logsToMap((await api(`/users/${encodeURIComponent(username)}/logs`)).logs);
  const progress = () => computeProgress(store.catalog, [...logs.values()]);
  const base = `/u/${user.username}`;

  mount(ctx.root, html`
    <section class="profile-head">
      <div class="ph-avatar"></div>
      <div class="ph-info">
        <h1>${user.displayName}</h1>
        <p class="muted">@${user.username} · se unió en ${fmtDate(user.createdAt, { month: 'long', year: 'numeric' })}</p>
        ${user.bio ? html`<p class="ph-bio">${user.bio}</p>` : own ? html`<p class="muted"><a href="/ajustes">Agrega una bio</a></p>` : ''}
      </div>
      <div class="ph-stats" id="ph-stats"></div>
    </section>
    <nav class="tabs">
      ${TABS.map(([t, label]) => html`<a href="${t ? `${base}/${t}` : base}" class="${t === tab ? 'active' : ''}">${label}</a>`)}
    </nav>
    <div id="profile-body"></div>`);
  $('.ph-avatar').append(avatar(user.username, 'lg'));

  const paintStats = () => {
    const p = progress();
    mount($('#ph-stats'), html`
      <a href="${base}/regiones"><b>${p.regions.visited}</b><span>Regiones</span></a>
      <a href="${base}/comunas"><b>${p.comunas.visited}</b><span>Comunas</span></a>
      <a href="${base}/resenas"><b>${p.counts.reviews}</b><span>Reseñas</span></a>
      <a href="${base}/logros"><b>${p.level.level}</b><span>Nivel</span></a>`);
  };
  paintStats();
  if (own) ctx.on('logs', () => { logs = store.logs; paintStats(); });

  const body = $('#profile-body');
  const tabs = { '': tabMap, comunas: tabPlaces('comuna'), regiones: tabPlaces('region'), resenas: tabReviews, 'quiero-ir': tabWishlist, logros: tabBadges };
  await tabs[tab]();

  // ---------------------------------------------------------------------------
  async function tabMap() {
    const mode = ctx.query.get('modo') === 'regiones' ? 'region' : 'comuna';
    mount(body, html`
      <div class="profile-map-layout">
        <div class="map-col">
          <div class="map-toolbar">
            <div class="seg" role="tablist">
              <button type="button" data-mode="region" class="${mode === 'region' ? 'on' : ''}">Regiones</button>
              <button type="button" data-mode="comuna" class="${mode === 'comuna' ? 'on' : ''}">Comunas</button>
            </div>
            ${own ? html`<label class="switch"><input type="checkbox" id="mark-mode"><span></span> Marcar con clic</label>` : ''}
          </div>
          <div class="map-frame" id="profile-map"></div>
          <p class="legend"><i class="lg-visited"></i>Visitado <i class="lg-wish"></i>Quiero ir <i class="lg-none"></i>Sin explorar (niebla)</p>
        </div>
        <aside class="side-col">
          <div id="level"></div>
          <h3 class="section-label">Progreso por región</h3>
          <div id="region-progress"></div>
        </aside>
      </div>
      <section class="section">
        <div class="section-head"><h2>Últimas reseñas</h2><a href="${base}/resenas">Ver todas</a></div>
        <div id="last-reviews"></div>
      </section>`);

    let markMode = false;
    const pm = new PixelMap({
      map: getMap('chile'), mode,
      stateOf: (t, c) => stateIn(logs, t, c),
      label: (t, c) => {
        const st = stateIn(logs, t, c);
        return `${placeName(t, c)}${st === 'visited' ? ' ✓' : st === 'wishlist' ? ' ⏲' : ''}`;
      },
      onClick: async (t, c) => {
        if (markMode) await quickToggle(t, c, 'visited');
        else ctx.navigate(`/${t}/${c}`);
      },
      maxScale: 4,
    });
    $('#profile-map').append(pm.el);
    ctx.onCleanup(() => pm.destroy());

    body.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      body.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
      pm.setMode(b.dataset.mode);
      history.replaceState(null, '', url(b.dataset.mode === 'region' ? `${base}?modo=regiones` : base));
    }));
    $('#mark-mode')?.addEventListener('change', (e) => {
      markMode = e.target.checked;
      if (markMode) toast(`Modo marcar: haz clic en ${pm.mode === 'region' ? 'una región' : 'una comuna'} para marcarla o desmarcarla.`, 'info', 3500);
    });

    const paintSide = () => {
      const p = progress();
      mount($('#level'), levelCard(p));
      mount($('#region-progress'), regionProgressList(p));
    };
    paintSide();
    if (own) ctx.on('logs', () => { pm.draw(); paintSide(); });

    const { reviews } = await api(`/users/${encodeURIComponent(user.username)}/reviews?limit=3`);
    const box = $('#last-reviews');
    if (!box) return;
    if (reviews.length) reviews.forEach((r) => box.append(reviewCard(r, { showUser: false })));
    else mount(box, emptyState(own ? 'Aún no escribes reseñas. Abre un lugar que hayas visitado y cuéntanos qué tal.' : 'Sin reseñas todavía.'));
  }

  function tabPlaces(type) {
    return async () => {
      const sort = ctx.query.get('orden') || 'geo';
      mount(body, html`
        <div class="filters">
          <label>Ordenar por
            <select id="sort">
              <option value="geo" ${sort === 'geo' ? 'selected' : ''}>Norte a sur</option>
              <option value="recent" ${sort === 'recent' ? 'selected' : ''}>Más recientes</option>
              <option value="rating" ${sort === 'rating' ? 'selected' : ''}>Mejor nota</option>
              <option value="name" ${sort === 'name' ? 'selected' : ''}>Nombre</option>
            </select>
          </label>
          <span class="muted" id="count"></span>
        </div>
        <div class="poster-grid" id="grid"></div>`);
      const order = new Map((type === 'region' ? store.catalog.regions : store.catalog.comunas).map((p, i) => [p.code, i]));
      const paint = () => {
        const s = $('#sort').value;
        const items = [...logs.values()].filter((l) => l.type === type && l.visited);
        items.sort((a, b) => {
          if (s === 'recent') return (b.visitedOn || b.createdAt).localeCompare(a.visitedOn || a.createdAt);
          if (s === 'rating') return (b.rating || 0) - (a.rating || 0) || order.get(a.code) - order.get(b.code);
          if (s === 'name') return placeName(type, a.code).localeCompare(placeName(type, b.code), 'es');
          return order.get(a.code) - order.get(b.code);
        });
        const total = type === 'region' ? store.catalog.regions.length : store.catalog.comunas.length;
        $('#count').textContent = `${items.length} de ${total} ${type === 'region' ? 'regiones' : 'comunas'}`;
        const grid = $('#grid');
        if (!items.length) {
          mount(grid, emptyState(own ? `Todavía no marcas ${type === 'region' ? 'regiones' : 'comunas'}.` : 'Nada por aquí todavía.',
            own ? html`<a class="btn btn-primary" href="/explorar${type === 'comuna' ? '?tab=comunas' : ''}">Explorar</a>` : ''));
          return;
        }
        grid.replaceChildren(...items.map((l) => poster(type, l.code, {
          logs, quick: own,
          sub: type === 'comuna' ? store.catalog.regionByCode.get(store.catalog.comunaByCode.get(l.code).region).shortName : `Región ${store.catalog.regionByCode.get(l.code).roman}`,
        })));
      };
      $('#sort').addEventListener('change', (e) => {
        history.replaceState(null, '', `${location.pathname}?orden=${e.target.value}`);
        paint();
      });
      paint();
      if (own) ctx.on('logs', () => { logs = store.logs; paint(); });
    };
  }

  async function tabReviews() {
    mount(body, html`<div id="reviews"></div><button class="btn" id="more" hidden>Cargar más</button>`);
    let offset = 0;
    const load = async () => {
      const { reviews } = await api(`/users/${encodeURIComponent(user.username)}/reviews?limit=20&offset=${offset}`);
      const box = $('#reviews');
      if (!reviews.length && !offset) mount(box, emptyState('Sin reseñas todavía.'));
      reviews.forEach((r) => box.append(reviewCard(r, { showUser: false })));
      offset += reviews.length;
      $('#more').hidden = reviews.length < 20;
    };
    $('#more').addEventListener('click', load);
    await load();
  }

  async function tabWishlist() {
    mount(body, html`<p class="muted">Lugares que ${own ? 'quieres' : 'quiere'} conocer.</p><div class="poster-grid" id="grid"></div>`);
    const paint = () => {
      const items = [...logs.values()].filter((l) => l.wishlist);
      const grid = $('#grid');
      if (!items.length) {
        mount(grid, emptyState(own ? html`Usa el botón ${icon('clock')} "Quiero ir" en cualquier lugar para armar tu lista.` : 'Lista vacía.'));
        return;
      }
      grid.replaceChildren(...items.map((l) => poster(l.type, l.code, { logs, quick: own })));
    };
    paint();
    if (own) ctx.on('logs', () => { logs = store.logs; paint(); });
  }

  async function tabBadges() {
    const paint = () => {
      const p = progress();
      mount(body, html`${levelCard(p)}
        <h2 class="section-title">Logros <small class="muted">${p.badges.filter((b) => b.earned).length}/${p.badges.length}</small></h2>
        ${badgesGrid(p)}
        <h2 class="section-title">Cómo ganar XP</h2>
        <ul class="xp-rules"><li>Comuna visitada: <b>+10 XP</b></li><li>Región visitada: <b>+40 XP</b></li><li>Reseña: <b>+5 XP</b></li><li>Nota: <b>+1 XP</b></li></ul>`);
    };
    paint();
    if (own) ctx.on('logs', () => { logs = store.logs; paint(); });
  }
}
