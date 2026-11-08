/**
 * Database layer for AniGlobe accounts.
 *
 * Uses @libsql/client (Turso's SQLite client) — the same client opens a local
 * file, an in-memory database, or a hosted Turso database. One SQLite dialect
 * everywhere; local dev, tests, and serverless (Vercel) share this code.
 *
 * URL selection (DATABASE_URL):
 *   unset (default)   file:<root>/data/aniglobe.db  — local dev, one file
 *   :memory:           in-memory (tests)
 *   libsql://...       hosted Turso (serverless); DATABASE_AUTH_TOKEN required
 *
 * Forward-only migrations tracked in schema_migrations. Foreign keys
 * enforced (PRAGMA locally; Turso enforces server-side). WAL is local-only
 * behavior; remote Turso manages journaling itself.
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

import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Each migration is an array of single statements (libsql runs one statement
// per execute call; the array runs as one atomic write batch).
const MIGRATIONS = [
  [
    `CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE,
      email TEXT NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )`,
    'CREATE UNIQUE INDEX users_username_unique ON users (username)',
    'CREATE UNIQUE INDEX users_email_unique ON users (email)',
    `CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT
    )`,
    'CREATE INDEX sessions_user_idx ON sessions (user_id)',
    'CREATE INDEX sessions_expires_idx ON sessions (expires_at)',
  ],
  [
    `CREATE TABLE wrapped_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE UNIQUE INDEX templates_user_name_unique ON templates (user_id, name COLLATE NOCASE)',
  ],
  [
    `CREATE TABLE guess_progress (
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      media_type TEXT NOT NULL CHECK (media_type IN ('anime', 'manga')),
      day_index INTEGER NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      won INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, media_type, day_index)
    )`,
  ],
  [
    `CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    )`,
  ],
  [
    'ALTER TABLE sessions ADD COLUMN last_seen_at TEXT',
    'CREATE INDEX sessions_last_seen_idx ON sessions (last_seen_at)',
    'ALTER TABLE users ADD COLUMN email_verified_at TEXT',
    `CREATE TABLE password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )`,
    `CREATE TABLE email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )`,
  ],
  [
    'ALTER TABLE users ADD COLUMN bio TEXT',
    'ALTER TABLE users ADD COLUMN avatar_data TEXT',
  ],
  [
    `ALTER TABLE templates ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0`,
    'CREATE INDEX templates_public_idx ON templates (is_public, updated_at DESC)',
  ],
];

function nowIso() {
  return new Date().toISOString();
}

function isLocalUrl(url) {
  return url === ':memory:' || url.startsWith('file:');
}

export async function openDatabase(url = process.env.DATABASE_URL || `file:${rootDir}/data/aniglobe.db`) {
  if (isLocalUrl(url) && url !== ':memory:') {
    const path = url.slice('file:'.length);
    mkdirSync(dirname(path), { recursive: true });
  }

  const clientConfig = { url };
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  if (authToken) clientConfig.authToken = authToken;
  const db = createClient(clientConfig);

  if (isLocalUrl(url)) {
    await db.execute('PRAGMA journal_mode = WAL');
    await db.execute('PRAGMA foreign_keys = ON');
    await db.execute('PRAGMA busy_timeout = 5000');
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applied_at TEXT NOT NULL
    )
  `);

  const maxRow = (await db.execute('SELECT MAX(id) AS n FROM schema_migrations')).rows[0];
  const applied = Number(maxRow && maxRow.n ? maxRow.n : 0);
  for (let i = applied; i < MIGRATIONS.length; i += 1) {
    const statements = MIGRATIONS[i];
    await db.batch(
      [...statements, { sql: 'INSERT INTO schema_migrations (applied_at) VALUES (?)', args: [nowIso()] }],
      'write'
    );
  }

  return db;
}

async function getRow(db, sql, args) {
  const result = await db.execute(sql, args);
  return result.rows[0] || null;
}

async function getRows(db, sql, args) {
  return (await db.execute(sql, args)).rows;
}

async function runWrite(db, sql, args) {
  return db.execute(sql, args);
}

/* ------------------------------------------------------------------ users */

export async function createUser(db, { username, email, passwordHash }) {
  const at = nowIso();
  return insert(db, 'users', {
    username,
    email,
    password_hash: passwordHash,
    created_at: at,
    updated_at: at,
  });
}

export async function getUserById(db, id) {
  return getRow(db, 'SELECT * FROM users WHERE id = ?', [id]);
}

export async function getUserByUsername(db, username) {
  return getRow(db, 'SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
}

export async function getUserByEmail(db, email) {
  return getRow(db, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);
}

export async function updateUserPassword(db, id, passwordHash) {
  await runWrite(db, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, nowIso(), id]);
}

export async function updateProfile(db, id, { bio, avatarData }) {
  await runWrite(db, 'UPDATE users SET bio = ?, avatar_data = ?, updated_at = ? WHERE id = ?', [bio, avatarData, nowIso(), id]);
}

export async function guessSummary(db, userId) {
  const row = await getRow(db, `
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) AS wins
    FROM guess_progress WHERE user_id = ?
  `, [userId]);
  return { total: Number(row.total || 0), wins: Number(row.wins || 0) };
}

export async function touchLogin(db, id) {
  await runWrite(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), id]);
}

export async function deleteUser(db, id) {
  await db.batch([
    { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [id] },
    { sql: 'DELETE FROM templates WHERE user_id = ?', args: [id] },
    { sql: 'DELETE FROM guess_progress WHERE user_id = ?', args: [id] },
    { sql: 'DELETE FROM wrapped_prefs WHERE user_id = ?', args: [id] },
    { sql: 'DELETE FROM password_reset_tokens WHERE user_id = ?', args: [id] },
    { sql: 'DELETE FROM email_verification_tokens WHERE user_id = ?', args: [id] },
    { sql: 'DELETE FROM users WHERE id = ?', args: [id] },
  ], 'write');
}

/* --------------------------------------------------------------- sessions */

export async function createSession(db, { userId, tokenHash, expiresAt, userAgent = null, ip = null }) {
  const at = nowIso();
  return insert(db, 'sessions', {
    user_id: userId,
    token_hash: tokenHash,
    created_at: at,
    expires_at: expiresAt,
    last_seen_at: at,
    user_agent: userAgent,
    ip,
  });
}

export async function getSessionByTokenHash(db, tokenHash) {
  const row = await getRow(db, 'SELECT * FROM sessions WHERE token_hash = ?', [tokenHash]);
  if (row && row.expires_at < nowIso()) {
    await runWrite(db, 'DELETE FROM sessions WHERE id = ?', [row.id]);
    return null;
  }
  return row;
}

/** Idle timeout: sessions unused for longer than idleMs are dead, even if the
   absolute expiry is still in the future. Legacy rows from before the
   last_seen_at migration fall back to created_at so they still expire. */
export function isSessionIdle(db, session, idleMs, now = Date.now()) {
  const stamp = session.last_seen_at || session.created_at;
  if (!stamp) return false;
  const ts = Date.parse(stamp);
  if (Number.isNaN(ts)) return false;
  return ts + idleMs < now;
}

export async function touchSession(db, id, at = nowIso()) {
  await runWrite(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', [at, id]);
}

export async function deleteSessionByTokenHash(db, tokenHash) {
  await runWrite(db, 'DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
}

export async function deleteAllSessionsForUser(db, userId) {
  await runWrite(db, 'DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export async function pruneExpiredSessions(db) {
  await runWrite(db, 'DELETE FROM sessions WHERE expires_at <= ?', [nowIso()]);
}

export async function countActiveSessions(db, userId, idleMs = 7 * 24 * 60 * 60 * 1000, now = Date.now()) {
  const cutoff = new Date(now - idleMs).toISOString();
  const row = await getRow(db, `
    SELECT COUNT(*) AS n FROM sessions
    WHERE user_id = ? AND expires_at > ?
      AND COALESCE(last_seen_at, created_at) > ?
  `, [userId, nowIso(), cutoff]);
  return row.n;
}

export async function listSessionsForUser(db, userId, idleMs = 7 * 24 * 60 * 60 * 1000, now = Date.now()) {
  const cutoff = new Date(now - idleMs).toISOString();
  return getRows(db, `
    SELECT id, created_at, expires_at, last_seen_at, user_agent, ip
    FROM sessions WHERE user_id = ? AND expires_at > ?
      AND COALESCE(last_seen_at, created_at) > ?
    ORDER BY created_at DESC
  `, [userId, nowIso(), cutoff]);
}

export async function getSessionById(db, id) {
  return getRow(db, 'SELECT * FROM sessions WHERE id = ?', [id]);
}

/* ----------------------------------------------------------- wrapped sync */

export async function saveWrappedPrefs(db, userId, payload) {
  await runWrite(db, `
    INSERT INTO wrapped_prefs (user_id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `, [userId, JSON.stringify(payload), nowIso()]);
}

export async function loadWrappedPrefs(db, userId) {
  const row = await getRow(db, 'SELECT payload, updated_at FROM wrapped_prefs WHERE user_id = ?', [userId]);
  return row ? { payload: JSON.parse(row.payload), updatedAt: row.updated_at } : null;
}

export async function upsertTemplate(db, userId, { name, payload }) {
  const at = nowIso();
  await runWrite(db, `
    INSERT INTO templates (user_id, name, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `, [userId, name, JSON.stringify(payload), at, at]);
}

export async function listTemplates(db, userId) {
  const rows = await getRows(db, 'SELECT name, payload, updated_at, is_public FROM templates WHERE user_id = ? ORDER BY updated_at DESC', [userId]);
  return rows.map((row) => ({ name: row.name, payload: JSON.parse(row.payload), updatedAt: row.updated_at, isPublic: row.is_public === 1 }));
}

export async function deleteTemplate(db, userId, name) {
  await runWrite(db, 'DELETE FROM templates WHERE user_id = ? AND name = ? COLLATE NOCASE', [userId, name]);
}

export async function setTemplatePublic(db, userId, name, isPublic) {
  const result = await runWrite(db, 'UPDATE templates SET is_public = ?, updated_at = ? WHERE user_id = ? AND name = ? COLLATE NOCASE', [isPublic ? 1 : 0, nowIso(), userId, name]);
  return Number(result.rowsAffected) > 0;
}

export async function listPublicTemplates(db, { limit = 50 } = {}) {
  const rows = await getRows(db, `
    SELECT templates.id, templates.name, templates.payload, templates.updated_at, users.username AS author
    FROM templates JOIN users ON users.id = templates.user_id
    WHERE templates.is_public = 1
    ORDER BY templates.updated_at DESC LIMIT ?
  `, [limit]);
  return rows.map((row) => {
    let payload = {};
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = {};
    }
    return {
      id: row.id,
      name: row.name,
      author: row.author,
      theme: typeof payload.theme === 'string' ? payload.theme : null,
      updatedAt: row.updated_at,
    };
  });
}

export async function getPublicTemplateById(db, id) {
  const row = await getRow(db, `
    SELECT templates.id, templates.name, templates.payload, templates.updated_at, templates.user_id, users.username AS author
    FROM templates JOIN users ON users.id = templates.user_id
    WHERE templates.id = ? AND templates.is_public = 1
  `, [id]);
  if (!row) return null;
  let payload = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = null;
  }
  return { id: row.id, name: row.name, payload, userId: row.user_id, author: row.author };
}

/* -------------------------------------------------------- guess progress */

export async function saveGuessProgress(db, userId, { mediaType, dayIndex, score, won }) {
  await runWrite(db, `
    INSERT INTO guess_progress (user_id, media_type, day_index, score, won, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, media_type, day_index) DO UPDATE SET
      score = excluded.score,
      won = excluded.won,
      updated_at = excluded.updated_at
  `, [userId, mediaType, dayIndex, score, won ? 1 : 0, nowIso()]);
}

export async function listGuessProgress(db, userId, mediaType = null) {
  const rows = mediaType
    ? await getRows(db, 'SELECT media_type, day_index, score, won FROM guess_progress WHERE user_id = ? AND media_type = ? ORDER BY day_index', [userId, mediaType])
    : await getRows(db, 'SELECT media_type, day_index, score, won FROM guess_progress WHERE user_id = ? ORDER BY media_type, day_index', [userId]);
  return rows.map((row) => ({
    mediaType: row.media_type,
    dayIndex: row.day_index,
    score: row.score,
    won: row.won === 1,
  }));
}

export async function markEmailVerified(db, userId) {
  await runWrite(db, 'UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), userId]);
}

/* -------------------------------------------------------- reset / verify */

export async function createResetToken(db, userId, tokenHash, expiresAt) {
  const at = nowIso();
  await db.batch([
    { sql: 'DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL', args: [userId] },
    { sql: 'INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)', args: [userId, tokenHash, at, expiresAt] },
  ], 'write');
}

export async function findResetToken(db, tokenHash) {
  return getRow(db, 'SELECT * FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
}

export async function useResetToken(db, tokenHash) {
  await runWrite(db, 'UPDATE password_reset_tokens SET used_at = ? WHERE token_hash = ?', [nowIso(), tokenHash]);
}

export async function createVerifyToken(db, userId, tokenHash, expiresAt) {
  const at = nowIso();
  await db.batch([
    { sql: 'DELETE FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL', args: [userId] },
    { sql: 'INSERT INTO email_verification_tokens (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)', args: [userId, tokenHash, at, expiresAt] },
  ], 'write');
}

export async function findVerifyToken(db, tokenHash) {
  return getRow(db, 'SELECT * FROM email_verification_tokens WHERE token_hash = ?', [tokenHash]);
}

export async function useVerifyToken(db, tokenHash) {
  await runWrite(db, 'UPDATE email_verification_tokens SET used_at = ? WHERE token_hash = ?', [nowIso(), tokenHash]);
}

/* -------------------------------------------------------- rate limits */

/**
 * One atomic upsert: when the window has expired the counter restarts at 1,
 * otherwise it increments. RETURNING gives the post-increment count, so the
 * allow/deny decision is made in the same round trip — no transaction, no
 * lock window. Denied requests still move the counter (harmless: the window
 * end time never extends on a denied attempt).
 */
export async function consumeRateLimit(db, key, windowMs, max, now = Date.now()) {
  const row = await getRow(db, `
    INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
    RETURNING count, reset_at
  `, [key, now + windowMs, now, now]);
  const count = Number(row.count);
  if (count > max) {
    return { allowed: false, retryAfterMs: row.reset_at - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export async function pruneRateLimits(db, now = Date.now()) {
  await runWrite(db, 'DELETE FROM rate_limits WHERE reset_at <= ?', [now]);
}

/* --------------------------------------------------------------- helpers */

async function insert(db, table, fields) {
  const columns = Object.keys(fields);
  const placeholders = columns.map(() => '?').join(', ');
  const result = await db.execute(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    columns.map((column) => fields[column])
  );
  const id = Number(result.rows[0].id);
  return getUserById(db, id);
}
