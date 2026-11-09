import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';

test('migra una base v1 (notas enteras y "me gusta") a v2 sin perder datos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visited-'));
  const file = path.join(dir, 'v1.db');
  // Crear una base v1 a mano.
  const v1 = new DatabaseSync(file);
  v1.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT 'x');
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, client TEXT,
      created_at TEXT NOT NULL DEFAULT 'x', expires_at TEXT NOT NULL);
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE TABLE logs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      place_type TEXT NOT NULL, place_code INTEGER NOT NULL, visited INTEGER NOT NULL DEFAULT 0, wishlist INTEGER NOT NULL DEFAULT 0,
      liked INTEGER NOT NULL DEFAULT 0, rating INTEGER CHECK (rating BETWEEN 1 AND 5), review TEXT, visited_on TEXT, review_at TEXT,
      created_at TEXT NOT NULL DEFAULT 'x', updated_at TEXT NOT NULL DEFAULT 'x', UNIQUE (user_id, place_type, place_code));
    CREATE INDEX logs_place ON logs(place_type, place_code);
    CREATE INDEX logs_review_at ON logs(review_at);
    INSERT INTO users (id, username, email, password_hash, display_name) VALUES (1, 'a', 'a@a.cl', 'h', 'A');
    INSERT INTO logs (id, user_id, place_type, place_code, visited, liked, rating, review) VALUES (7, 1, 'comuna', 5201, 1, 1, 4, 'Bonito');
    PRAGMA user_version = 1;`);
  v1.close();

  const db = openDb(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  const row = db.prepare('SELECT * FROM logs WHERE id = 7').get();
  assert.equal(row.rating, 4);
  assert.equal(row.review, 'Bonito');
  assert.equal('liked' in row, false);
  db.prepare('UPDATE logs SET rating = 4.5 WHERE id = 7').run();
  assert.throws(() => db.prepare('UPDATE logs SET rating = 4.25 WHERE id = 7').run());
  db.prepare('INSERT INTO review_votes (log_id, user_id, value) VALUES (7, 1, 1)').run();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
