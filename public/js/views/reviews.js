import { html, mount, $ } from '../html.js';
import { api } from '../api.js';
import { reviewCard, emptyState } from '../components.js';

export async function reviewsView(ctx) {
  document.title = 'Reseñas · Visited Chile';
  const type = ['region', 'comuna'].includes(ctx.query.get('tipo')) ? ctx.query.get('tipo') : '';
  mount(ctx.root, html`
    <section class="page-head">
      <h1>Reseñas recientes</h1>
      <nav class="tabs">
        <a href="/resenas" class="${!type ? 'active' : ''}">Todas</a>
        <a href="/resenas?tipo=comuna" class="${type === 'comuna' ? 'active' : ''}">Comunas</a>
        <a href="/resenas?tipo=region" class="${type === 'region' ? 'active' : ''}">Regiones</a>
      </nav>
    </section>
    <div id="feed"></div>
    <button class="btn" id="more" hidden>Cargar más</button>`);
  let offset = 0;
  const load = async () => {
    const { reviews } = await api(`/reviews?limit=20&offset=${offset}${type ? `&type=${type}` : ''}`);
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
