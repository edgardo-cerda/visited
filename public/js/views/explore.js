import { html, mount, $, norm } from '../html.js';
import { store, me, stateIn, myProgress } from '../store.js';
import { poster, bar } from '../components.js';

export async function exploreView(ctx) {
  document.title = 'Explorar · Visited Chile';
  const tab = ctx.query.get('tab') === 'comunas' ? 'comunas' : 'regiones';
  const { regions } = store.catalog;
  mount(ctx.root, html`
    <section class="page-head">
      <h1>Explorar Chile</h1>
      <p class="muted">Regiones y comunas se registran por separado: puedes marcar una región aunque no hayas recorrido todas sus comunas.</p>
      <nav class="tabs">
        <a href="/explorar" class="${tab === 'regiones' ? 'active' : ''}">Regiones <small>16</small></a>
        <a href="/explorar?tab=comunas" class="${tab === 'comunas' ? 'active' : ''}">Comunas <small>346</small></a>
      </nav>
    </section>
    <div id="explore-body"></div>`);
  const body = $('#explore-body');

  if (tab === 'regiones') {
    const paint = () => {
      const p = me() ? myProgress() : null;
      mount(body, html`<div class="region-grid"></div>`);
      const grid = $('.region-grid', body);
      for (const r of regions) {
        const rp = p?.byRegion.find((x) => x.code === r.code);
        const card = poster('region', r.code, { quick: true, caption: false });
        const wrap = document.createElement('div');
        wrap.className = 'region-card';
        wrap.append(card);
        const info = document.createElement('div');
        info.className = 'region-card-info';
        mount(info, html`<a href="/region/${r.code}" class="rc-name">${r.shortName}</a>
          <span class="muted">Región ${r.roman} · ${r.comunaCount} comunas</span>
          ${rp ? html`${bar(rp.visitedComunas / rp.totalComunas, 'small')}<span class="muted">${rp.visitedComunas}/${rp.totalComunas} comunas visitadas</span>` : ''}`);
        wrap.append(info);
        grid.append(wrap);
      }
    };
    paint();
    ctx.on('logs', paint);
    return;
  }

  // ---- Comunas con filtros --------------------------------------------------
  const state = { q: ctx.query.get('q') || '', region: ctx.query.get('region') || '', status: ctx.query.get('status') || '' };
  mount(body, html`
    <div class="filters">
      <input type="search" id="f-q" placeholder="Filtrar por nombre…" value="${state.q}">
      <select id="f-region">
        <option value="">Todas las regiones</option>
        ${regions.map((r) => html`<option value="${r.code}" ${String(r.code) === state.region ? 'selected' : ''}>${r.roman} · ${r.shortName}</option>`)}
      </select>
      ${me() ? html`<select id="f-status">
        <option value="">Todas</option>
        <option value="visited" ${state.status === 'visited' ? 'selected' : ''}>Visitadas</option>
        <option value="pending" ${state.status === 'pending' ? 'selected' : ''}>No visitadas</option>
        <option value="wishlist" ${state.status === 'wishlist' ? 'selected' : ''}>Quiero ir</option>
      </select>` : ''}
      <span class="muted" id="f-count"></span>
    </div>
    <div class="poster-grid" id="comuna-grid"></div>`);

  const grid = $('#comuna-grid');
  const paint = () => {
    const q = norm(state.q);
    const list = store.catalog.comunas.filter((c) => {
      if (state.region && String(c.region) !== state.region) return false;
      if (q && !norm(c.name).includes(q)) return false;
      const st = stateIn(store.logs, 'comuna', c.code);
      if (state.status === 'visited' && st !== 'visited') return false;
      if (state.status === 'pending' && st === 'visited') return false;
      if (state.status === 'wishlist' && st !== 'wishlist') return false;
      return true;
    });
    $('#f-count').textContent = `${list.length} comuna${list.length === 1 ? '' : 's'}`;
    grid.replaceChildren(...list.map((c) => poster('comuna', c.code, {
      quick: true, sub: state.region ? c.province : store.catalog.regionByCode.get(c.region).shortName,
    })));
  };
  const sync = () => {
    const qs = new URLSearchParams({ tab: 'comunas' });
    for (const k of ['q', 'region', 'status']) if (state[k]) qs.set(k, state[k]);
    history.replaceState(null, '', `/explorar?${qs}`);
    paint();
  };
  $('#f-q').addEventListener('input', (e) => { state.q = e.target.value; sync(); });
  $('#f-region').addEventListener('change', (e) => { state.region = e.target.value; sync(); });
  $('#f-status')?.addEventListener('change', (e) => { state.status = e.target.value; sync(); });
  paint();
  ctx.on('logs', paint);
}
