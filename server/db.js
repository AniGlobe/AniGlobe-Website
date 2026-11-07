/**
 * Database layer for AniGlobe accounts.
 *
 * Uses node:sqlite (built into Node 22+) — zero native dependencies for a
 * transactional, embedded store. One SQLite file on disk, WAL mode on, foreign
 * keys enforced. Forward-only migrations tracked in schema_migrations.
 *
 * Data model:
 *   users            id, username (unique, case-insensitive), email (unique,
 *                    case-insensitive), password_hash (scrypt, self-describing),
 *                    created_at, updated_at, last_login_at
 *   sessions         id, user_id, token_hash (sha256 of the raw token),
 *                    created_at, expires_at, user_agent, ip
 *   wrapped_prefs    user_id, payload (JSON), updated_at  — synced Wrapped display prefs
 *   templates        id, user_id, name, payload (JSON), created_at, updated_at
 *   guess_progress   user_id, media_type, day_index, score, won, updated_at
 *                    (daily puzzle streak/score sync)
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url)) + '/..';

const MIGRATIONS = [
  (db) => {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE,
        email TEXT NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE UNIQUE INDEX users_username_unique ON users (username);
      CREATE UNIQUE INDEX users_email_unique ON users (email);

      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT,
        ip TEXT
      );
      CREATE INDEX sessions_user_idx ON sessions (user_id);
      CREATE INDEX sessions_expires_idx ON sessions (expires_at);
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE wrapped_prefs (
        user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX templates_user_name_unique ON templates (user_id, name COLLATE NOCASE);
    `);
  },
  (db) => {
    db.exec(`
      CREATE TABLE guess_progress (
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK (media_type IN ('anime', 'manga')),
        day_index INTEGER NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        won INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, media_type, day_index)
      );
    `);
  },
];

function nowIso() {
  return new Date().toISOString();
}

export function openDatabase(filename = process.env.DATABASE_URL || `${rootDir}/data/aniglobe.db`) {
  const resolved = filename === ':memory:' ? ':memory:' : filename;
  if (resolved !== ':memory:') {
    mkdirSync(dirname(resolved), { recursive: true });
  }

  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
  for (let i = applied; i < MIGRATIONS.length; i += 1) {
    const migrate = MIGRATIONS[i];
    try {
      db.exec('BEGIN');
      migrate(db);
      db.prepare('INSERT INTO schema_migrations (applied_at) VALUES (?)').run(nowIso());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return db;
}

/* ------------------------------------------------------------------ users */

export function createUser(db, { username, email, passwordHash }) {
  const at = nowIso();
  insert(db, 'users', {
    username,
    email,
    password_hash: passwordHash,
    created_at: at,
    updated_at: at,
  });
  const id = lastInsertRowId(db);
  return getUserById(db, id);
}

export function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

export function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username) || null;
}

export function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) || null;
}

export function updateUserPassword(db, id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, nowIso(), id);
}

export function touchLogin(db, id) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), id);
}

export function deleteUser(db, id) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM templates WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM guess_progress WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM wrapped_prefs WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

/* --------------------------------------------------------------- sessions */

export function createSession(db, { userId, tokenHash, expiresAt, userAgent = null, ip = null }) {
  const at = nowIso();
  insert(db, 'sessions', {
    user_id: userId,
    token_hash: tokenHash,
    created_at: at,
    expires_at: expiresAt,
    user_agent: userAgent,
    ip,
  });
  return lastInsertRowId(db);
}

export function getSessionByTokenHash(db, tokenHash) {
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash) || null;
  if (row && row.expires_at < nowIso()) return null;
  return row;
}

export function deleteSessionByTokenHash(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteAllSessionsForUser(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function pruneExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

export function countActiveSessions(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?')
    .get(userId, nowIso()).n;
}

/* ----------------------------------------------------------- wrapped sync */

export function saveWrappedPrefs(db, userId, payload) {
  db.prepare(`
    INSERT INTO wrapped_prefs (user_id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(userId, JSON.stringify(payload), nowIso());
}

export function loadWrappedPrefs(db, userId) {
  const row = db.prepare('SELECT payload, updated_at FROM wrapped_prefs WHERE user_id = ?').get(userId);
  return row ? { payload: JSON.parse(row.payload), updatedAt: row.updated_at } : null;
}

export function upsertTemplate(db, userId, { name, payload }) {
  const at = nowIso();
  db.prepare(`
    INSERT INTO templates (user_id, name, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(userId, name, JSON.stringify(payload), at, at);
}

export function listTemplates(db, userId) {
  const rows = db.prepare('SELECT name, payload, updated_at FROM templates WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId);
  return rows.map((row) => ({ name: row.name, payload: JSON.parse(row.payload), updatedAt: row.updated_at }));
}

export function deleteTemplate(db, userId, name) {
  db.prepare('DELETE FROM templates WHERE user_id = ? AND name = ? COLLATE NOCASE').run(userId, name);
}

/* -------------------------------------------------------- guess progress */

export function saveGuessProgress(db, userId, { mediaType, dayIndex, score, won }) {
  db.prepare(`
    INSERT INTO guess_progress (user_id, media_type, day_index, score, won, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, media_type, day_index) DO UPDATE SET
      score = excluded.score,
      won = excluded.won,
      updated_at = excluded.updated_at
  `).run(userId, mediaType, dayIndex, score, won ? 1 : 0, nowIso());
}

export function listGuessProgress(db, userId, mediaType = null) {
  const rows = mediaType
    ? db.prepare('SELECT media_type, day_index, score, won FROM guess_progress WHERE user_id = ? AND media_type = ? ORDER BY day_index')
      .all(userId, mediaType)
    : db.prepare('SELECT media_type, day_index, score, won FROM guess_progress WHERE user_id = ? ORDER BY media_type, day_index')
      .all(userId);
  return rows.map((row) => ({
    mediaType: row.media_type,
    dayIndex: row.day_index,
    score: row.score,
    won: row.won === 1,
  }));
}

/* --------------------------------------------------------------- helpers */

function insert(db, table, fields) {
  const columns = Object.keys(fields);
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(...columns.map((column) => fields[column]));
}

function lastInsertRowId(db) {
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}
