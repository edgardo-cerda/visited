import { html, mount, $, esc, el } from './html.js';
import { BASE, DEMO, url, appPath, stripBase } from './config.js';
import { store, on, me, loadCatalog, loadMaps, refreshMe, searchPlaces, placeUrl } from './store.js';
import { avatar, loading, toast } from './components.js';
import { homeView } from './views/home.js';
import { loginView, registerView } from './views/auth.js';
import { exploreView } from './views/explore.js';
import { placeView } from './views/place.js';
import { profileView } from './views/profile.js';
import { reviewsView } from './views/reviews.js';
import { settingsView } from './views/settings.js';

const routes = [
  [/^\/$/, homeView],
  [/^\/ingresar$/, loginView],
  [/^\/registro$/, registerView],
  [/^\/explorar$/, exploreView],
  [/^\/(region|comuna)\/(\d+)$/, (ctx, type, code) => placeView(ctx, type, Number(code))],
  [/^\/u\/([A-Za-z0-9_]+)(?:\/([a-z-]+))?$/, (ctx, user, tab) => profileView(ctx, user, tab)],
  [/^\/resenas$/, reviewsView],
  [/^\/ajustes$/, settingsView],
];

const app = $('#app');
let cleanup = [];

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', url(path));
  else history.pushState(null, '', url(path));
  render();
}

async function render() {
  for (const fn of cleanup) fn();
  cleanup = [];
  const path = appPath();
  const ctx = {
    root: app,
    query: new URLSearchParams(location.search),
    navigate,
    on: (evt, fn) => cleanup.push(on(evt, fn)),
    onCleanup: (fn) => cleanup.push(fn),
  };
  renderNav();
  window.scrollTo(0, 0);
  for (const [re, view] of routes) {
    const m = re.exec(path);
    if (m) {
      mount(app, loading());
      try {
        await view(ctx, ...m.slice(1));
      } catch (e) {
        console.error(e);
        mount(app, html`<div class="empty"><h1>Ups</h1><p>${e.message || 'Algo salió mal.'}</p><a class="btn" href="/">Volver al inicio</a></div>`);
      }
      return;
    }
  }
  document.title = 'No encontrado · Visited Chile';
  mount(app, html`<div class="empty"><h1>404</h1><p>Esta ruta no está en el mapa.</p><a class="btn" href="/">Volver al inicio</a></div>`);
}

function renderNav() {
  const u = me();
  const path = appPath();
  const link = (href, label) => html`<a href="${href}" class="${path === href || (href !== '/' && path.startsWith(href)) ? 'active' : ''}">${label}</a>`;
  mount($('#mainnav'), html`
    ${link('/explorar', 'Explorar')}
    ${link('/resenas', 'Reseñas')}
    ${u ? html`<a href="/u/${u.username}" class="nav-user ${path.startsWith(`/u/${u.username}`) ? 'active' : ''}"><span class="av-slot"></span><span class="nav-username">${u.displayName}</span></a>
           <a href="/ajustes" class="${path === '/ajustes' ? 'active' : ''}" title="Ajustes">Ajustes</a>`
      : html`${link('/ingresar', 'Ingresar')}<a href="/registro" class="btn btn-primary btn-sm">Crear cuenta</a>`}
  `);
  const slot = $('#mainnav .av-slot');
  if (slot && u) slot.replaceWith(avatar(u.username, 'xs'));
}

// Enlaces internos sin recargar la página.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const raw = a.getAttribute('href');
  if (!raw.startsWith('/') || raw.startsWith('//') || a.target || a.hasAttribute('download')) return;
  e.preventDefault();
  const href = stripBase(raw);
  if (href !== appPath() + location.search) navigate(href);
});
window.addEventListener('popstate', render);

// ---------------------------------------------------------------------------
// Buscador
// ---------------------------------------------------------------------------
function setupSearch() {
  const input = $('#search');
  const list = $('#search-results');
  let items = [], sel = 0;
  const close = () => { list.hidden = true; };
  const paint = () => {
    mount(list, items.length
      ? items.map((it, i) => html`<li><a href="${placeUrl(it.type, it.code)}" class="${i === sel ? 'sel' : ''}"><b>${it.label}</b><span>${it.type === 'region' ? 'Región' : it.sub}</span></a></li>`)
      : html`<li class="none">Sin resultados</li>`);
    list.hidden = false;
  };
  input.addEventListener('input', () => {
    items = searchPlaces(input.value);
    sel = 0;
    if (!input.value.trim()) return close();
    paint();
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) { navigate(placeUrl(items[sel].type, items[sel].code)); input.value = ''; close(); input.blur(); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('click', () => { input.value = ''; close(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) close(); });
}

// ---------------------------------------------------------------------------
// Si la web vive bajo un prefijo (GitHub Pages: /visited), corrige los enlaces internos.
function fixLinks(root) {
  if (!BASE || !root.querySelectorAll) return;
  const all = root.matches?.('a[href^="/"]') ? [root, ...root.querySelectorAll('a[href^="/"]')] : root.querySelectorAll('a[href^="/"]');
  for (const a of all) {
    const h = a.getAttribute('href');
    if (!h.startsWith('//') && stripBase(h) === h) a.setAttribute('href', BASE + h);
  }
}
if (BASE) {
  fixLinks(document);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) fixLinks(n);
  }).observe(document.body, { childList: true, subtree: true });
}

if (DEMO) {
  document.body.prepend(el(html`<div class="demo-banner">VERSIÓN DE PRUEBA · Las cuentas, visitas y reseñas se guardan solo en este navegador.</div>`));
}

async function start() {
  mount(app, loading());
  await Promise.all([loadCatalog(), loadMaps()]);
  setupSearch();
  on('session', renderNav);
  if (store.session?.token) {
    try { await refreshMe(); } catch { toast('No se pudo cargar tu sesión.', 'error'); }
  }
  render();
}

start().catch((e) => {
  console.error(e);
  mount(app, html`<div class="empty"><h1>Error</h1><p>${esc(e.message)}</p></div>`);
});
