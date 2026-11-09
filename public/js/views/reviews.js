import { html, mount, $ } from '../html.js';
import { api } from '../api.js';
import { reviewCard, emptyState } from '../components.js';

export async function reviewsView(ctx) {
  document.title = 'Reseñas · Visited Chile';
  const type = ['region', 'comuna'].includes(ctx.query.get('tipo')) ? ctx.query.get('tipo') : '';
  const sort = ctx.query.get('orden') === 'recientes' ? 'recent' : 'top';
  const link = (t, s) => {
    const qs = new URLSearchParams();
    if (t) qs.set('tipo', t);
    if (s === 'recent') qs.set('orden', 'recientes');
    return `/resenas${qs.size ? `?${qs}` : ''}`;
  };
  mount(ctx.root, html`
    <section class="page-head">
      <h1>Reseñas</h1>
      <nav class="tabs">
        <a href="${link('', sort)}" class="${!type ? 'active' : ''}">Todas</a>
        <a href="${link('comuna', sort)}" class="${type === 'comuna' ? 'active' : ''}">Comunas</a>
        <a href="${link('region', sort)}" class="${type === 'region' ? 'active' : ''}">Regiones</a>
      </nav>
      <div class="filters">
        <div class="seg seg-sm">
          <a href="${link(type, 'top')}" class="${sort === 'top' ? 'on' : ''}">Más votadas</a>
          <a href="${link(type, 'recent')}" class="${sort === 'recent' ? 'on' : ''}">Recientes</a>
        </div>
        <span class="muted">${sort === 'top' ? 'Ordenadas por votos netos (me gusta menos no me gusta).' : 'Las más nuevas primero.'}</span>
      </div>
    </section>
    <div id="feed"></div>
    <button class="btn" id="more" hidden>Cargar más</button>`);
  let offset = 0;
  const load = async () => {
    const { reviews } = await api(`/reviews?sort=${sort}&limit=20&offset=${offset}${type ? `&type=${type}` : ''}`);
    const feed = $('#feed');
    if (!feed) return;
    if (!reviews.length && !offset) mount(feed, emptyState('Todavía no hay reseñas.'));
    reviews.forEach((r) => feed.append(reviewCard(r)));
    offset += reviews.length;
    $('#more').hidden = reviews.length < 20;
  };
  $('#more').addEventListener('click', load);
  await load();
}
