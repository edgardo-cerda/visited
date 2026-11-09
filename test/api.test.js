import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let server, base, db;

before(async () => {
  db = openDb(':memory:');
  const app = createApp(db, { corsOrigins: ['*'] });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(() => { server.close(); db.close(); });

async function call(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

let token, token2;

test('catálogo: 16 regiones y 346 comunas', async () => {
  const r = await call('GET', '/catalog');
  assert.equal(r.status, 200);
  assert.equal(r.body.regions.length, 16);
  assert.equal(r.body.comunas.length, 346);
});

test('registro y validaciones', async () => {
  let r = await call('POST', '/auth/register', { body: { username: 'ab', email: 'x@y.cl', password: '12345678' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.field, 'username');

  r = await call('POST', '/auth/register', { body: { username: 'viajera', email: 'Viajera@Mail.cl', password: 'corta' } });
  assert.equal(r.status, 400);

  r = await call('POST', '/auth/register', { body: { username: 'viajera', email: 'Viajera@Mail.cl', password: 'clave-secreta', displayName: 'La Viajera' } });
  assert.equal(r.status, 201);
  assert.ok(r.body.token);
  assert.equal(r.body.user.email, 'viajera@mail.cl');
  assert.equal(r.body.user.displayName, 'La Viajera');
  token = r.body.token;

  r = await call('POST', '/auth/register', { body: { username: 'VIAJERA', email: 'otro@mail.cl', password: 'clave-secreta' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.field, 'username');

  r = await call('POST', '/auth/register', { body: { username: 'pato', email: 'pato@mail.cl', password: 'otra-clave-1' } });
  assert.equal(r.status, 201);
  token2 = r.body.token;
});

test('login por usuario o email', async () => {
  let r = await call('POST', '/auth/login', { body: { login: 'viajera@mail.cl', password: 'mala-clave' } });
  assert.equal(r.status, 401);
  r = await call('POST', '/auth/login', { body: { login: 'Viajera', password: 'clave-secreta' } });
  assert.equal(r.status, 200);
  r = await call('POST', '/auth/login', { body: { login: 'viajera@mail.cl', password: 'clave-secreta' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.username, 'viajera');
});

test('/me requiere token', async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', { token: 'nope' })).status, 401);
  const r = await call('GET', '/me', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.username, 'viajera');
});

test('marcar comunas y regiones por separado', async () => {
  let r = await call('PUT', '/me/logs/comuna/13101', { token, body: { visited: true } });
  assert.equal(r.status, 200);
  assert.equal(r.body.log.visited, true);

  // Marcar una comuna no marca su región.
  r = await call('GET', '/me/logs/region/13', { token });
  assert.equal(r.body.log, null);

  r = await call('PUT', '/me/logs/region/13', { token, body: { visited: true } });
  assert.equal(r.body.log.type, 'region');

  r = await call('PUT', '/me/logs/comuna/99999', { token, body: { visited: true } });
  assert.equal(r.status, 404);
  r = await call('PUT', '/me/logs/pais/1', { token, body: { visited: true } });
  assert.equal(r.status, 400);
});

test('reseña y nota marcan como visitado; validaciones', async () => {
  let r = await call('PUT', '/me/logs/comuna/5201', { token, body: { rating: 5, review: '  Los moái al amanecer.  ', visitedOn: '2024-02-10' } });
  assert.equal(r.status, 200);
  assert.deepEqual(
    { visited: r.body.log.visited, rating: r.body.log.rating, review: r.body.log.review, visitedOn: r.body.log.visitedOn },
    { visited: true, rating: 5, review: 'Los moái al amanecer.', visitedOn: '2024-02-10' },
  );
  assert.ok(r.body.log.reviewAt);

  assert.equal((await call('PUT', '/me/logs/comuna/5201', { token, body: { rating: 6 } })).status, 400);
  assert.equal((await call('PUT', '/me/logs/comuna/5201', { token, body: { rating: 3.25 } })).status, 400);
  assert.equal((await call('PUT', '/me/logs/comuna/5201', { token, body: { rating: 0 } })).status, 400);
  assert.equal((await call('PUT', '/me/logs/comuna/5201', { token, body: { rating: '4' } })).status, 400);
  // Medias estrellas
  r = await call('PUT', '/me/logs/comuna/5201', { token, body: { rating: 4.5 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.log.rating, 4.5);
  r = await call('PUT', '/me/logs/comuna/5201', { token, body: { rating: 5 } });
  assert.equal(r.body.log.liked, undefined, 'ya no existe "me gusta" en lugares');
  assert.equal((await call('PUT', '/me/logs/comuna/5201', { token, body: { visitedOn: '2999-01-01' } })).status, 400);
  assert.equal((await call('PUT', '/me/logs/comuna/5201', { token, body: { visitedOn: '2024-02-30' } })).status, 400);

  // Quiero ir no aplica si ya fue visitado.
  assert.equal((await call('PUT', '/me/logs/comuna/5201', { token, body: { wishlist: true } })).status, 409);
});

test('quiero ir y desmarcar', async () => {
  let r = await call('PUT', '/me/logs/comuna/12201', { token, body: { wishlist: true } });
  assert.equal(r.body.log.wishlist, true);
  assert.equal(r.body.log.visited, false);

  // Visitar lo saca de "quiero ir".
  r = await call('PUT', '/me/logs/comuna/12201', { token, body: { visited: true } });
  assert.equal(r.body.log.wishlist, false);

  // Desmarcar borra el registro.
  r = await call('PUT', '/me/logs/comuna/12201', { token, body: { visited: false } });
  assert.equal(r.body.log, null);

  r = await call('DELETE', '/me/logs/comuna/13101', { token });
  assert.equal(r.status, 204);
});

test('carga masiva', async () => {
  const items = [13101, 13114, 13123].map((code) => ({ type: 'comuna', code, visited: true }));
  let r = await call('POST', '/me/logs/batch', { token, body: { items } });
  assert.equal(r.status, 200);
  assert.equal(r.body.logs.filter((l) => l.type === 'comuna' && l.visited).length, 4);
  r = await call('POST', '/me/logs/batch', { token, body: { items: [{ type: 'comuna', code: 13114, visited: false }] } });
  assert.equal(r.body.logs.filter((l) => l.type === 'comuna' && l.visited).length, 3);
});

test('progreso, nivel y logros', async () => {
  const r = await call('GET', '/me/progress', { token });
  assert.equal(r.status, 200);
  assert.equal(r.body.comunas.visited, 3);
  assert.equal(r.body.regions.visited, 1);
  assert.equal(r.body.counts.reviews, 1);
  // 3 comunas * 10 + 1 región * 40 + 1 reseña * 5 + 1 nota * 1
  assert.equal(r.body.level.xp, 76);
  assert.equal(r.body.level.level, 2);
  assert.ok(r.body.badges.find((b) => b.id === 'rapa-nui').earned);
  assert.equal(r.body.byRegion.find((x) => x.code === 13).visitedComunas, 2);
});

test('página de lugar con estadísticas y reseñas', async () => {
  await call('PUT', '/me/logs/comuna/5201', { token: token2, body: { rating: 3.5 } });
  let r = await call('GET', '/places/comuna/5201', { token: token2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.place.name, 'Isla de Pascua');
  assert.equal(r.body.stats.visitors, 2);
  assert.equal(r.body.stats.averageRating, 4.25);
  // histograma: 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5
  assert.deepEqual(r.body.stats.histogram, [0, 0, 0, 0, 0, 0, 1, 0, 0, 1]);
  assert.equal(r.body.stats.likes, undefined);
  assert.equal(r.body.reviews.length, 1);
  assert.equal(r.body.reviews[0].user.username, 'viajera');
  assert.equal(r.body.myLog.rating, 3.5);
  assert.deepEqual(r.body.reviews[0].votes, { up: 0, down: 0, score: 0 });

  r = await call('GET', '/reviews');
  assert.equal(r.body.reviews.length, 1);
  r = await call('GET', '/stats/places?type=comuna');
  assert.ok(r.body.places.find((p) => p.code === 5201).visitors === 2);
});

test('votos en reseñas y orden por votos netos', async () => {
  // Tres usuarios más que reseñan y votan.
  const users = [];
  for (const name of ['ana', 'beto', 'caro']) {
    const r = await call('POST', '/auth/register', { body: { username: name, email: `${name}@mail.cl`, password: 'clave-secreta' } });
    users.push(r.body.token);
  }
  const [ana, beto, caro] = users;
  await call('PUT', '/me/logs/comuna/5201', { token: ana, body: { review: 'Reseña de Ana' } });
  await call('PUT', '/me/logs/comuna/5201', { token: beto, body: { review: 'Reseña de Beto' } });
  let r = await call('GET', '/places/comuna/5201/reviews?sort=recent');
  const byUser = Object.fromEntries(r.body.reviews.map((x) => [x.user.username, x.id]));
  assert.equal(r.body.reviews[0].user.username, 'beto', 'recientes primero');

  // No se puede votar sin sesión ni la propia reseña; valores válidos.
  assert.equal((await call('PUT', `/reviews/${byUser.ana}/vote`, { body: { value: 1 } })).status, 401);
  assert.equal((await call('PUT', `/reviews/${byUser.ana}/vote`, { token: ana, body: { value: 1 } })).status, 403);
  assert.equal((await call('PUT', `/reviews/${byUser.ana}/vote`, { token: beto, body: { value: 2 } })).status, 400);
  assert.equal((await call('PUT', '/reviews/999999/vote', { token: beto, body: { value: 1 } })).status, 404);

  // viajera: +2 (beto, caro) ; ana: +1 -1 = 0 ; beto: -1
  await call('PUT', `/reviews/${byUser.viajera}/vote`, { token: beto, body: { value: 1 } });
  r = await call('PUT', `/reviews/${byUser.viajera}/vote`, { token: caro, body: { value: 1 } });
  assert.deepEqual(r.body.review.votes, { up: 2, down: 0, score: 2 });
  assert.equal(r.body.review.myVote, 1);
  await call('PUT', `/reviews/${byUser.ana}/vote`, { token: beto, body: { value: 1 } });
  await call('PUT', `/reviews/${byUser.ana}/vote`, { token: caro, body: { value: -1 } });
  await call('PUT', `/reviews/${byUser.beto}/vote`, { token: caro, body: { value: 1 } });
  r = await call('PUT', `/reviews/${byUser.beto}/vote`, { token: caro, body: { value: -1 } }); // cambia el voto
  assert.deepEqual(r.body.review.votes, { up: 0, down: 1, score: -1 });

  r = await call('GET', '/places/comuna/5201', { token: caro });
  assert.deepEqual(r.body.reviews.map((x) => [x.user.username, x.votes.score]), [['viajera', 2], ['ana', 0], ['beto', -1]]);
  assert.deepEqual(r.body.reviews.map((x) => x.myVote), [1, -1, -1]);
  r = await call('GET', '/reviews');
  assert.equal(r.body.reviews[0].user.username, 'viajera');
  assert.equal((await call('GET', '/reviews?sort=raro')).status, 400);

  // Quitar el voto
  r = await call('PUT', `/reviews/${byUser.viajera}/vote`, { token: caro, body: { value: 0 } });
  assert.equal(r.body.review.votes.score, 1);

  // Borrar la reseña borra sus votos
  await call('PUT', '/me/logs/comuna/5201', { token: beto, body: { review: null } });
  await call('PUT', '/me/logs/comuna/5201', { token: beto, body: { review: 'De nuevo' } });
  r = await call('GET', '/places/comuna/5201/reviews?sort=recent');
  assert.deepEqual(r.body.reviews[0].votes, { up: 0, down: 0, score: 0 });
});

test('perfil público no expone email', async () => {
  const r = await call('GET', '/users/viajera');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, undefined);
  assert.equal(r.body.summary.comunas.visited, 3);
  assert.equal((await call('GET', '/users/nadie')).status, 404);
  const logs = await call('GET', '/users/viajera/logs?type=region');
  assert.equal(logs.body.logs.length, 1);
});

test('CORS para apps', async () => {
  const res = await fetch(`${base}/catalog`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:8081' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('cambio de contraseña, logout y borrado de cuenta', async () => {
  let r = await call('POST', '/me/password', { token: token2, body: { currentPassword: 'mala', newPassword: 'nueva-clave-1' } });
  assert.equal(r.status, 401);
  r = await call('POST', '/me/password', { token: token2, body: { currentPassword: 'otra-clave-1', newPassword: 'nueva-clave-1' } });
  assert.equal(r.status, 204);
  assert.equal((await call('GET', '/me', { token: token2 })).status, 200);

  assert.equal((await call('POST', '/auth/logout', { token })).status, 204);
  assert.equal((await call('GET', '/me', { token })).status, 401);

  r = await call('DELETE', '/me', { token: token2, body: { password: 'nueva-clave-1' } });
  assert.equal(r.status, 204);
  assert.equal((await call('GET', '/users/pato')).status, 404);
  // Quedan viajera, ana y beto (pato se fue con su cuenta).
  r = await call('GET', '/places/comuna/5201');
  assert.equal(r.body.stats.visitors, 3);
});
