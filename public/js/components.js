/** Componentes de interfaz reutilizables (iconos pixel, estrellas, pósters, modales…). */
import { html, raw, el, esc, fmtDate, timeAgo, $ } from './html.js';
import { store, getMap, stateIn, placeUrl, saveLog, me } from './store.js';
import { posterCanvas, avatarCanvas } from './pixelmap.js';

// ---------------------------------------------------------------------------
// Iconos pixel art (SVG con rects)
// ---------------------------------------------------------------------------
const ICONS = {
  star: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
  eye: ['..#####..', '.#.....#.', '#...#...#', '#..###..#', '#...#...#', '.#.....#.', '..#####..'],
  heart: ['.##...##.', '####.####', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  clock: ['..#####..', '.#.....#.', '#...#...#', '#...#...#', '#...###.#', '#.......#', '.#.....#.', '..#####..'],
  pen: ['......##', '.....###', '....###.', '...###..', '..###...', '.###....', '##......', '#.......'],
  pin: ['.###.', '#####', '##.##', '#####', '.###.', '..#..', '..#..'],
  check: ['.......#', '......##', '#....##.', '##..##..', '.####...', '..##....'],
  x: ['#.....#', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#.....#'],
  trophy: ['#######', '#.###.#', '#.###.#', '.#####.', '..###..', '...#...', '..###..', '.#####.'],
  map: ['##..##..', '#.##..##', '#.#.#..#', '#.#.#..#', '#.#.#..#', '##..##.#', '..##..##'],
};

export function icon(name, cls = '') {
  const rows = ICONS[name];
  const w = rows[0].length, h = rows.length;
  let d = '';
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') d += `M${x} ${y}h1v1h-1z`; }));
  return raw(`<svg class="icon icon-${name} ${cls}" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`);
}

// ---------------------------------------------------------------------------
// Estrellas
// ---------------------------------------------------------------------------
export function stars(n, cls = '') {
  if (!n) return '';
  return html`<span class="stars ${cls}" title="${n} de 5 estrellas" aria-label="${n} de 5 estrellas">${Array.from({ length: n }, () => icon('star'))}</span>`;
}

/** Selector de estrellas interactivo. Clic en la misma nota la borra. */
export function starInput(value, onChange) {
  const node = el(html`<div class="star-input" role="radiogroup" aria-label="Tu nota">
    ${[1, 2, 3, 4, 5].map((i) => html`<button type="button" class="star-btn" data-v="${i}" role="radio" aria-checked="${value === i}" aria-label="${i} estrella${i > 1 ? 's' : ''}">${icon('star')}</button>`)}
  </div>`);
  let current = value || 0;
  const paint = (n) => node.querySelectorAll('.star-btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= n));
  paint(current);
  node.addEventListener('mouseover', (e) => { const b = e.target.closest('.star-btn'); if (b) paint(Number(b.dataset.v)); });
  node.addEventListener('mouseleave', () => paint(current));
  node.addEventListener('click', (e) => {
    const b = e.target.closest('.star-btn');
    if (!b) return;
    const v = Number(b.dataset.v);
    current = v === current ? 0 : v;
    paint(current);
    onChange(current || null);
  });
  node.setValue = (v) => { current = v || 0; paint(current); };
  return node;
}

// ---------------------------------------------------------------------------
// Pósters (siluetas)
// ---------------------------------------------------------------------------
export function mapsFor(type, code) {
  if (type === 'region') return [getMap('chile')];
  const c = store.catalog.comunaByCode.get(code);
  return [getMap(`r${c.region}`), c.region === 13 ? getMap('santiago') : null];
}

/** Elemento póster con enlace, nombre y acciones rápidas opcionales. */
export function poster(type, code, { logs = store.logs, quick = false, caption = true, sub = null, size = '' } = {}) {
  const place = type === 'region' ? store.catalog.regionByCode.get(code) : store.catalog.comunaByCode.get(code);
  const st = stateIn(logs, type, code);
  const log = logs.get(`${type}:${code}`);
  const node = el(html`<div class="poster ${size} ${st ? `is-${st}` : ''}" data-type="${type}" data-code="${code}">
    <a class="poster-frame" href="${placeUrl(type, code)}" title="${place.name}">
      <span class="poster-badges">
        ${st === 'visited' ? html`<span class="pb pb-visited" title="Visitado">${icon('eye')}</span>` : ''}
        ${st === 'wishlist' ? html`<span class="pb pb-wish" title="Quiero ir">${icon('clock')}</span>` : ''}
        ${log?.liked ? html`<span class="pb pb-like" title="Me gusta">${icon('heart')}</span>` : ''}
      </span>
      ${type === 'region' ? html`<span class="poster-roman">${place.roman}</span>` : ''}
    </a>
    ${quick && me() ? html`<div class="poster-quick">
      <button type="button" class="q q-visited ${st === 'visited' ? 'on' : ''}" data-act="visited" title="${st === 'visited' ? 'Quitar visita' : 'Marcar como visitado'}">${icon('eye')}</button>
      <button type="button" class="q q-like ${log?.liked ? 'on' : ''}" data-act="liked" title="Me gusta">${icon('heart')}</button>
      <button type="button" class="q q-wish ${st === 'wishlist' ? 'on' : ''}" data-act="wishlist" title="Quiero ir" ${st === 'visited' ? 'disabled' : ''}>${icon('clock')}</button>
    </div>` : ''}
    ${caption ? html`<div class="poster-caption"><a href="${placeUrl(type, code)}">${place.name}</a>${sub ? html`<span class="poster-sub">${sub}</span>` : ''}${log?.rating ? stars(log.rating, 'small') : ''}</div>` : ''}
  </div>`);
  const frame = node.querySelector('.poster-frame');
  frame.prepend(posterCanvas(type, code, mapsFor(type, code), (t, c) => stateIn(logs, t, c)));
  if (quick) {
    node.querySelector('.poster-quick')?.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      await quickToggle(type, code, b.dataset.act);
    });
  }
  return node;
}

/** Alterna visitado / me gusta / quiero ir y muestra feedback. */
export async function quickToggle(type, code, act) {
  const log = store.logs.get(`${type}:${code}`);
  const name = type === 'region' ? store.catalog.regionByCode.get(code).name : store.catalog.comunaByCode.get(code).name;
  let patch;
  if (act === 'visited') {
    if (log?.visited && (log.review || log.rating)) {
      if (!(await confirmDialog(`¿Quitar ${name} de tus visitas? Se borrarán tu nota y tu reseña.`))) return;
    }
    patch = { visited: !log?.visited };
  } else if (act === 'liked') patch = { liked: !log?.liked };
  else patch = { wishlist: !log?.wishlist };
  try {
    const { log: next, before, after } = await saveLog(type, code, patch);
    if (act === 'visited') {
      const gained = after.level.xp - before.level.xp;
      toast(next?.visited ? `${name}: visitado (+${gained} XP)` : `${name}: quitado de tus visitas`, next?.visited ? 'ok' : '');
    } else if (act === 'wishlist') toast(next?.wishlist ? `${name} en "Quiero ir"` : `${name} fuera de "Quiero ir"`, 'info');
    else if (next?.liked) toast(`Te gusta ${name}`, 'like');
    levelUpCheck(before, after);
  } catch (e) {
    toast(e.message, 'error');
  }
}

export function levelUpCheck(before, after) {
  if (after.level.level > before.level.level) {
    toast(`¡Subiste a nivel ${after.level.level}: ${after.level.title}!`, 'level', 5000);
  }
  const prev = new Set(before.badges.filter((b) => b.earned).map((b) => b.id));
  for (const b of after.badges) if (b.earned && !prev.has(b.id)) toast(`Logro desbloqueado: ${b.name}`, 'level', 5000);
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------
export function avatar(username, size = 'md') {
  const span = el(html`<span class="avatar avatar-${size}"></span>`);
  span.append(avatarCanvas(username));
  return span;
}

// ---------------------------------------------------------------------------
// Barras de progreso
// ---------------------------------------------------------------------------
export function bar(fraction, cls = '') {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return html`<div class="pbar ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="pbar-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
}

export function levelCard(p) {
  const l = p.level;
  return html`<div class="card level-card">
    <div class="level-head">
      <div class="level-num"><small>NIVEL</small>${l.level}</div>
      <div>
        <div class="level-title">${l.title}</div>
        <div class="muted">${l.xp} XP${l.nextLevelXp ? html` · faltan ${l.nextLevelXp - l.xp} XP para <b>${l.nextTitle}</b>` : ' · ¡nivel máximo!'}</div>
      </div>
    </div>
    ${bar(l.progress, 'xp')}
    <div class="stat-grid">
      <div class="stat"><b>${p.regions.visited}<small>/${p.regions.total}</small></b><span>Regiones</span>${bar(p.regions.visited / p.regions.total)}</div>
      <div class="stat"><b>${p.comunas.visited}<small>/${p.comunas.total}</small></b><span>Comunas</span>${bar(p.comunas.visited / p.comunas.total)}</div>
      <div class="stat"><b>${p.area.percent}<small>%</small></b><span>del territorio</span>${bar(p.area.percent / 100)}</div>
    </div>
  </div>`;
}

export function regionProgressList(p, { link = true } = {}) {
  return html`<ul class="region-progress">
    ${p.byRegion.map((r) => html`<li class="${r.regionVisited ? 'is-visited' : ''}">
      <span class="rp-roman">${r.roman}</span>
      ${link ? html`<a href="/region/${r.code}" class="rp-name">${r.shortName}</a>` : html`<span class="rp-name">${r.shortName}</span>`}
      <span class="rp-check" title="${r.regionVisited ? 'Región visitada' : 'Región no marcada'}">${r.regionVisited ? icon('eye') : ''}</span>
      ${bar(r.visitedComunas / r.totalComunas, 'small')}
      <span class="rp-count">${r.visitedComunas}/${r.totalComunas}</span>
    </li>`)}
  </ul>`;
}

export function badgesGrid(p) {
  return html`<div class="badges">
    ${p.badges.map((b) => html`<div class="badge ${b.earned ? 'earned' : ''}" title="${b.description}">
      <span class="badge-icon">${icon(b.earned ? 'trophy' : 'trophy')}</span>
      <span class="badge-name">${b.name}</span>
      <span class="badge-desc">${b.description}</span>
      ${b.target > 1 ? html`<span class="badge-prog">${b.current}/${b.target}</span>` : ''}
    </div>`)}
  </div>`;
}

// ---------------------------------------------------------------------------
// Reseñas
// ---------------------------------------------------------------------------
export function reviewCard(r, { showPlace = true, showUser = true } = {}) {
  const node = el(html`<article class="review">
    ${showPlace && r.place ? html`<a class="review-poster" href="${placeUrl(r.place.type, r.place.code)}"></a>` : ''}
    <div class="review-body">
      ${showPlace && r.place ? html`<h3 class="review-place"><a href="${placeUrl(r.place.type, r.place.code)}">${r.place.name}</a>
        <span class="muted">${r.place.type === 'region' ? `Región ${r.place.roman}` : r.place.region.shortName}</span></h3>` : ''}
      <div class="review-meta">
        ${showUser ? html`<a class="review-user" href="/u/${r.user.username}"><span class="av-slot"></span>${r.user.displayName}</a>` : ''}
        ${stars(r.rating, 'small')}
        ${r.liked ? html`<span class="like-mark" title="Le gusta">${icon('heart')}</span>` : ''}
        <span class="muted">${r.visitedOn ? `Visitado el ${fmtDate(r.visitedOn)}` : timeAgo(r.reviewAt)}</span>
      </div>
      <div class="review-text"></div>
    </div>
  </article>`);
  // Texto con saltos de línea, siempre como texto plano.
  const text = node.querySelector('.review-text');
  for (const para of String(r.review || '').split(/\n{2,}/)) {
    const p = document.createElement('p');
    p.textContent = para;
    text.append(p);
  }
  if (showUser) node.querySelector('.av-slot').replaceWith(avatar(r.user.username, 'xs'));
  if (showPlace && r.place) {
    node.querySelector('.review-poster').append(posterCanvas(r.place.type, r.place.code, mapsFor(r.place.type, r.place.code), () => null));
  }
  return node;
}

// ---------------------------------------------------------------------------
// Toasts y diálogos
// ---------------------------------------------------------------------------
export function toast(msg, kind = '', ms = 2800) {
  const t = el(html`<div class="toast ${kind}">${msg}</div>`);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function modal(content, { title = '', wide = false } = {}) {
  const dlg = el(html`<dialog class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h2>${title}</h2><button type="button" class="btn-icon modal-close" aria-label="Cerrar">${icon('x')}</button></div>
    <div class="modal-body"></div>
  </dialog>`);
  dlg.querySelector('.modal-body').append(content);
  dlg.querySelector('.modal-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmDialog(message, { ok = 'Sí, continuar', cancel = 'Cancelar' } = {}) {
  return new Promise((resolve) => {
    const body = el(html`<div><p>${message}</p><div class="form-actions">
      <button type="button" class="btn" data-r="0">${cancel}</button>
      <button type="button" class="btn btn-danger" data-r="1">${ok}</button></div></div>`);
    const dlg = modal(body, { title: 'Confirmar' });
    let result = false;
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      result = b.dataset.r === '1';
      dlg.close();
    });
    dlg.addEventListener('close', () => resolve(result));
  });
}

/** Modal para registrar/editar visita con fecha, nota, reseña y me gusta. */
export function openLogEditor(type, code) {
  const place = type === 'region' ? store.catalog.regionByCode.get(code) : store.catalog.comunaByCode.get(code);
  const log = store.logs.get(`${type}:${code}`) || {};
  let rating = log.rating || null;
  const today = new Date();
  const todayIso = new Date(today.getTime() - today.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const form = el(html`<form class="log-editor">
    <div class="le-head">
      <div class="le-poster"></div>
      <div>
        <p class="le-kicker">Registré mi visita a…</p>
        <h3>${place.name}</h3>
        <label class="field inline"><span>Fecha de visita</span><input type="date" name="visitedOn" max="${todayIso}" value="${log.visitedOn || ''}"></label>
        <div class="le-row">
          <div><span class="field-label">Nota</span><span class="le-stars"></span></div>
          <label class="like-toggle"><input type="checkbox" name="liked" ${log.liked ? 'checked' : ''}> ${icon('heart')} Me gusta</label>
        </div>
      </div>
    </div>
    <label class="field"><span>Reseña <small class="muted">(opcional)</small></span>
      <textarea name="review" rows="7" maxlength="5000" placeholder="¿Qué tal estuvo? Lugares, comida, gente, paisajes…">${log.review || ''}</textarea></label>
    <p class="form-error" hidden></p>
    <div class="form-actions">
      ${log.review ? html`<button type="button" class="btn btn-ghost" data-act="del-review">Borrar reseña</button>` : ''}
      <button type="submit" class="btn btn-primary">Guardar</button>
    </div>
  </form>`);
  form.querySelector('.le-poster').append(posterCanvas(type, code, mapsFor(type, code), (t, c) => stateIn(store.logs, t, c)));
  form.querySelector('.le-stars').append(starInput(rating, (v) => { rating = v; }));
  const dlg = modal(form, { title: log.visited ? 'Editar registro' : 'Registrar visita', wide: true });
  const err = form.querySelector('.form-error');
  const submit = async (extra = {}) => {
    const fd = new FormData(form);
    const patch = {
      visited: true,
      rating,
      liked: fd.get('liked') === 'on',
      visitedOn: fd.get('visitedOn') || null,
      review: String(fd.get('review') || '').trim() || null,
      ...extra,
    };
    try {
      const { before, after } = await saveLog(type, code, patch);
      dlg.close();
      toast(patch.review ? 'Reseña guardada' : 'Visita registrada', 'ok');
      levelUpCheck(before, after);
    } catch (e2) {
      err.hidden = false;
      err.textContent = e2.message;
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  form.querySelector('[data-act="del-review"]')?.addEventListener('click', () => submit({ review: null }));
  return dlg;
}

export const loading = () => html`<div class="loading"><span></span><span></span><span></span></div>`;
export const emptyState = (msg, action = '') => html`<div class="empty">${icon('map')}<p>${msg}</p>${action}</div>`;
export { esc };
