import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Migraciones en orden; la versión actual se guarda en PRAGMA user_version. */
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client     TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE logs (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_type TEXT NOT NULL CHECK (place_type IN ('region', 'comuna')),
    place_code INTEGER NOT NULL,
    visited    INTEGER NOT NULL DEFAULT 0 CHECK (visited IN (0, 1)),
    wishlist   INTEGER NOT NULL DEFAULT 0 CHECK (wishlist IN (0, 1)),
    liked      INTEGER NOT NULL DEFAULT 0 CHECK (liked IN (0, 1)),
    rating     INTEGER CHECK (rating BETWEEN 1 AND 5),
    review     TEXT,
    visited_on TEXT,
    review_at  TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, place_type, place_code)
  );
  CREATE INDEX logs_place ON logs(place_type, place_code);
  CREATE INDEX logs_review_at ON logs(review_at);
  `,
  // v2: notas con medias estrellas (0.5–5), sin "me gusta" en lugares, votos en reseñas.
  `
  CREATE TABLE logs_v2 (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_type TEXT NOT NULL CHECK (place_type IN ('region', 'comuna')),
    place_code INTEGER NOT NULL,
    visited    INTEGER NOT NULL DEFAULT 0 CHECK (visited IN (0, 1)),
    wishlist   INTEGER NOT NULL DEFAULT 0 CHECK (wishlist IN (0, 1)),
    rating     REAL CHECK (rating >= 0.5 AND rating <= 5 AND rating * 2 = CAST(rating * 2 AS INTEGER)),
    review     TEXT,
    visited_on TEXT,
    review_at  TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (user_id, place_type, place_code)
  );
  INSERT INTO logs_v2 (id, user_id, place_type, place_code, visited, wishlist, rating, review, visited_on, review_at, created_at, updated_at)
    SELECT id, user_id, place_type, place_code, visited, wishlist, rating, review, visited_on, review_at, created_at, updated_at FROM logs;
  DROP TABLE logs;
  ALTER TABLE logs_v2 RENAME TO logs;
  CREATE INDEX logs_place ON logs(place_type, place_code);
  CREATE INDEX logs_review_at ON logs(review_at);

  CREATE TABLE review_votes (
    log_id     INTEGER NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value      INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (log_id, user_id)
  );
  CREATE INDEX review_votes_user ON review_votes(user_id);
  `,
  // v3: visitar una comuna marca su región (código de región = código de comuna / 1000).
  `
  INSERT INTO logs (user_id, place_type, place_code, visited, wishlist)
    SELECT DISTINCT user_id, 'region', place_code / 1000, 1, 0 FROM logs
    WHERE place_type = 'comuna' AND visited = 1
  ON CONFLICT (user_id, place_type, place_code) DO UPDATE SET visited = 1, wishlist = 0;
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

/** Ejecuta `fn` dentro de una transacción. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
