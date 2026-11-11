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

// Each migration is an async function returning single statements (libsql
// runs one statement per execute call; the array runs as one atomic write
// batch). Every statement is idempotent — IF NOT EXISTS for creates, and
// column checks before ALTER — because on serverless, several instances can
// cold-start at the same time and race the same migrations. Idempotent DDL
// makes the race harmless: both instances converge on the same schema.
async function hasColumn(db, table, column) {
  const rows = (await db.execute(`PRAGMA table_info(${table})`)).rows;
  return rows.some((row) => row.name === column);
}

const MIGRATIONS = [
  async () => [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE,
      email TEXT NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username)',
    'CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)',
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)',
    'CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at)',
  ],
  async () => [
    `CREATE TABLE IF NOT EXISTS wrapped_prefs (
      user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS templates_user_name_unique ON templates (user_id, name COLLATE NOCASE)',
  ],
  async () => [
    `CREATE TABLE IF NOT EXISTS guess_progress (
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      media_type TEXT NOT NULL CHECK (media_type IN ('anime', 'manga')),
      day_index INTEGER NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      won INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, media_type, day_index)
    )`,
  ],
  async () => [
    `CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    )`,
  ],
  async (db) => {
    const statements = [];
    if (!(await hasColumn(db, 'sessions', 'last_seen_at'))) {
      statements.push('ALTER TABLE sessions ADD COLUMN last_seen_at TEXT');
    }
    statements.push('CREATE INDEX IF NOT EXISTS sessions_last_seen_idx ON sessions (last_seen_at)');
    if (!(await hasColumn(db, 'users', 'email_verified_at'))) {
      statements.push('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
    }
    statements.push(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )`);
    statements.push(`CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )`);
    return statements;
  },
  async (db) => {
    const statements = [];
    if (!(await hasColumn(db, 'users', 'bio'))) {
      statements.push('ALTER TABLE users ADD COLUMN bio TEXT');
    }
    if (!(await hasColumn(db, 'users', 'avatar_data'))) {
      statements.push('ALTER TABLE users ADD COLUMN avatar_data TEXT');
    }
    return statements;
  },
  async (db) => {
    const statements = [];
    if (!(await hasColumn(db, 'templates', 'is_public'))) {
      statements.push('ALTER TABLE templates ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
    }
    statements.push('CREATE INDEX IF NOT EXISTS templates_public_idx ON templates (is_public, updated_at DESC)');
    return statements;
  },
  async (db) => {
    return [
      `CREATE TABLE IF NOT EXISTS template_likes (
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        template_id INTEGER NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, template_id)
      )`,
      'CREATE INDEX IF NOT EXISTS template_likes_template_idx ON template_likes (template_id)',
    ];
  },
  async (db) => {
    const statements = [];
    if (!(await hasColumn(db, 'users', 'oauth_provider'))) {
      statements.push('ALTER TABLE users ADD COLUMN oauth_provider TEXT');
    }
    if (!(await hasColumn(db, 'users', 'oauth_subject'))) {
      statements.push('ALTER TABLE users ADD COLUMN oauth_subject TEXT');
    }
    statements.push('CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_subject_unique ON users (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL');
    statements.push(
      `CREATE TABLE IF NOT EXISTS oauth_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_hash TEXT NOT NULL UNIQUE,
        code_verifier TEXT NOT NULL,
        user_id INTEGER REFERENCES users (id) ON DELETE CASCADE,
        mode TEXT NOT NULL DEFAULT 'login',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      )`
    );
    return statements;
  },
  async (db) => {
    // Catalogue snapshot (we own it; providers are only read on a miss).
    // media.id is our own surrogate key; provider ids live in media_id_map.
    // provider_id is namespaced by type ("anime:12") because the provider
    // keeps separate id spaces for anime and manga.
    return [
      `CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        title_en TEXT,
        title_romaji TEXT,
        title_native TEXT,
        title_norm TEXT,
        format TEXT,
        subtype TEXT,
        episodes INTEGER,
        chapters INTEGER,
        volumes INTEGER,
        media_status TEXT,
        season TEXT,
        season_year INTEGER,
        average_rating REAL,
        popularity INTEGER,
        genres TEXT,
        cover_url TEXT,
        synopsis TEXT,
        nsfw INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT NOT NULL,
        updated_at TEXT,
        expires_at TEXT
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS media_provider_unique ON media (provider, provider_id)',
      'CREATE INDEX IF NOT EXISTS media_title_norm_idx ON media (title_norm)',
      `CREATE TABLE IF NOT EXISTS media_id_map (
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
        PRIMARY KEY (provider, provider_id)
      )`,
      `CREATE TABLE IF NOT EXISTS media_search_tokens (
        token TEXT NOT NULL,
        media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
        PRIMARY KEY (token, media_id)
      )`,
      'CREATE INDEX IF NOT EXISTS media_search_tokens_media_idx ON media_search_tokens (media_id)',
      'CREATE INDEX IF NOT EXISTS media_search_tokens_token_idx ON media_search_tokens (token)',
      `CREATE TABLE IF NOT EXISTS media_genre_tokens (
        genre TEXT NOT NULL,
        media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
        PRIMARY KEY (genre, media_id)
      )`,
      'CREATE INDEX IF NOT EXISTS media_genre_tokens_genre_idx ON media_genre_tokens (genre)',
      `CREATE TABLE IF NOT EXISTS library_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        media_id INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'PLANNING',
        progress INTEGER NOT NULL DEFAULT 0,
        score REAL,
        notes TEXT,
        favourite INTEGER NOT NULL DEFAULT 0,
        rewatch_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        source TEXT NOT NULL DEFAULT 'local',
        remote_entry_id TEXT,
        sync_state TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (user_id, media_id)
      )`,
      'CREATE INDEX IF NOT EXISTS library_entries_user_idx ON library_entries (user_id, updated_at DESC)',
      `CREATE TABLE IF NOT EXISTS library_sync_state (
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        last_sync_at TEXT,
        last_error TEXT,
        pulled INTEGER NOT NULL DEFAULT 0,
        pushed INTEGER NOT NULL DEFAULT 0,
        conflicted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, provider)
      )`,
      `CREATE TABLE IF NOT EXISTS catalogue_sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        fetched INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        error TEXT
      )`,
    ];
  },
  async (db) => {
    // Browsing needs a media type and indexed filter columns, otherwise a
    // "browse by year/genre" query scans the whole snapshot.
    const statements = [];
    if (!(await hasColumn(db, 'media', 'media_type'))) {
      statements.push('ALTER TABLE media ADD COLUMN media_type TEXT');
    }
    statements.push('CREATE INDEX IF NOT EXISTS media_type_idx ON media (media_type)');
    statements.push('CREATE INDEX IF NOT EXISTS media_year_idx ON media (media_type, season_year)');
    statements.push('CREATE INDEX IF NOT EXISTS media_popularity_idx ON media (media_type, popularity)');
    statements.push('CREATE INDEX IF NOT EXISTS media_rating_idx ON media (media_type, average_rating)');
    statements.push('CREATE INDEX IF NOT EXISTS media_format_idx ON media (media_type, format)');
    statements.push('CREATE INDEX IF NOT EXISTS media_status_idx ON media (media_type, media_status)');
    statements.push('CREATE INDEX IF NOT EXISTS media_season_idx ON media (media_type, season, season_year)');
    return statements;
  },
  async (db) => {
    // The crawl needs a cursor to resume from, and the sync report keeps the
    // position so an operator can see how far the catalogue has been filled.
    const statements = [
      `CREATE TABLE IF NOT EXISTS catalogue_cursors (
        provider TEXT NOT NULL,
        media_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        cursor INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, media_type, kind)
      )`,
    ];
    if (!(await hasColumn(db, 'catalogue_sync_runs', 'mode'))) {
      statements.push('ALTER TABLE catalogue_sync_runs ADD COLUMN mode TEXT');
    }
    if (!(await hasColumn(db, 'catalogue_sync_runs', 'cursor'))) {
      statements.push('ALTER TABLE catalogue_sync_runs ADD COLUMN cursor INTEGER NOT NULL DEFAULT 0');
    }
    if (!(await hasColumn(db, 'catalogue_sync_runs', 'total'))) {
      statements.push('ALTER TABLE catalogue_sync_runs ADD COLUMN total INTEGER');
    }
    if (!(await hasColumn(db, 'catalogue_sync_runs', 'media_type'))) {
      statements.push('ALTER TABLE catalogue_sync_runs ADD COLUMN media_type TEXT');
    }
    return statements;
  },
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
    // Idempotent per-statement DDL: concurrent cold starts may apply the
    // same migration at the same time — both converge on the same schema.
    // A duplicated schema_migrations row is harmless (MAX(id) just advances
    // past the loop bound, which then no-ops).
    //
    // The one remaining window is the hasColumn check-then-act race on
    // ALTER: the loser of that race gets a duplicate-column error AFTER the
    // winner committed. Retry once with freshly derived statements — the
    // re-check now sees the winner's column and skips the ALTER, and the
    // IF NOT EXISTS creates no-op. That is deterministic, not luck.
    const marker = { sql: 'INSERT INTO schema_migrations (applied_at) VALUES (?)', args: [nowIso()] };
    try {
      const statements = await MIGRATIONS[i](db);
      await db.batch([...statements, marker], 'write');
    } catch (error) {
      const statements = await MIGRATIONS[i](db);
      await db.batch([...statements, marker], 'write');
    }
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
  const id = await insert(db, 'users', {
    username,
    email,
    password_hash: passwordHash,
    created_at: at,
    updated_at: at,
  });
  return getUserById(db, id);
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

export async function getUserByOAuth(db, provider, subject) {
  return getRow(db, 'SELECT * FROM users WHERE oauth_provider = ? AND oauth_subject = ?', [provider, subject]);
}

export async function linkOAuth(db, userId, provider, subject) {
  await runWrite(db, 'UPDATE users SET oauth_provider = ?, oauth_subject = ?, updated_at = ? WHERE id = ?', [provider, subject, nowIso(), userId]);
}

export async function unlinkOAuth(db, userId) {
  await runWrite(db, 'UPDATE users SET oauth_provider = NULL, oauth_subject = NULL, updated_at = ? WHERE id = ?', [nowIso(), userId]);
}

export async function createOAuthState(db, { stateHash, codeVerifier, userId, mode, expiresAt }) {
  await runWrite(db, 'INSERT INTO oauth_states (state_hash, code_verifier, user_id, mode, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [stateHash, codeVerifier, userId != null ? userId : null, mode, nowIso(), expiresAt]);
}

export async function findOAuthState(db, stateHash) {
  return getRow(db, 'SELECT * FROM oauth_states WHERE state_hash = ?', [stateHash]);
}

export async function useOAuthState(db, stateHash) {
  await runWrite(db, 'UPDATE oauth_states SET used_at = ? WHERE state_hash = ?', [nowIso(), stateHash]);
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

export async function listPublicTemplates(db, { limit = 50, offset = 0, viewerId = null } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const rows = await getRows(db, `
    SELECT templates.id, templates.name, templates.payload, templates.updated_at, users.username AS author,
           (SELECT COUNT(*) FROM template_likes WHERE template_id = templates.id) AS like_count,
           (? IS NOT NULL AND EXISTS (SELECT 1 FROM template_likes WHERE user_id = ? AND template_id = templates.id)) AS loved
    FROM templates JOIN users ON users.id = templates.user_id
    WHERE templates.is_public = 1
    ORDER BY templates.updated_at DESC LIMIT ? OFFSET ?
  `, [viewerId != null ? viewerId : null, viewerId != null ? viewerId : null, safeLimit, safeOffset]);
  return rows.map((row) => {
    let payload = {};
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = {};
    }
    const sectionCount = Array.isArray(payload.order)
      ? payload.order.filter((id) => typeof id === 'string').length
      : 0;
    return {
      id: row.id,
      name: row.name,
      author: row.author,
      theme: typeof payload.theme === 'string' ? payload.theme : null,
      layout: payload.layout === 'story' ? 'story' : 'square',
      sections: sectionCount,
      likes: Number(row.like_count || 0),
      loved: row.loved === 1 || row.loved === true,
      updatedAt: row.updated_at,
    };
  });
}

export async function setTemplateLike(db, userId, templateId, loved) {
  if (loved) {
    return runWrite(db, 'INSERT OR IGNORE INTO template_likes (user_id, template_id, created_at) VALUES (?, ?, ?)', [userId, templateId, nowIso()]);
  }
  return runWrite(db, 'DELETE FROM template_likes WHERE user_id = ? AND template_id = ?', [userId, templateId]);
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

export async function pruneExpiredTokens(db) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await runWrite(db, 'DELETE FROM password_reset_tokens WHERE expires_at <= ? OR (used_at IS NOT NULL AND created_at <= ?)', [nowIso(), cutoff]);
  await runWrite(db, 'DELETE FROM email_verification_tokens WHERE expires_at <= ? OR (used_at IS NOT NULL AND created_at <= ?)', [nowIso(), cutoff]);
}

export async function createResetToken(db, userId, tokenHash, expiresAt) {
  const at = nowIso();
  await pruneExpiredTokens(db).catch(() => {});
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
  await pruneExpiredTokens(db).catch(() => {});
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

/* ------------------------------------------------------ catalogue snapshot */

export function normaliseTitle(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

export function tokeniseTitle(text) {
  const normalised = normaliseTitle(text);
  if (!normalised) return [];
  return [...new Set(normalised.split(' ').filter(Boolean))];
}

/** Look up a snapshot row by provider id. */
export async function getMediaByProviderId(db, provider, providerId) {
  return getRow(db, 'SELECT * FROM media WHERE provider = ? AND provider_id = ?', [provider, providerId]);
}

export async function getMediaById(db, id) {
  return getRow(db, 'SELECT * FROM media WHERE id = ?', [id]);
}

/**
 * Insert or refresh a snapshot row and its search tokens.
 *
 * Tokens are replaced wholesale so a title change cannot leave stale rows.
 * The writes are batched: one statement for the row, one for the id map,
 * one for the title tokens and one for the genre tokens. A title carries
 * around thirty genres, so writing them one by one made the crawl
 * statement-bound rather than network-bound.
 */
export async function upsertMedia(db, media, tokens, genreTokens = []) {
  const at = nowIso();
  const values = [
    media.provider, media.providerId,
    media.titleEn, media.titleRomaji, media.titleNative, media.titleNorm,
    media.format, media.subtype, media.episodes, media.chapters, media.volumes,
    media.status, media.season, media.seasonYear, media.averageRating,
    media.popularity, media.genres, media.coverUrl, media.synopsis,
    media.nsfw ? 1 : 0, media.mediaType || null,
    media.updatedAt || null, at, media.expiresAt || null,
  ];

  const result = await runWrite(
    db,
    `INSERT INTO media (
       provider, provider_id,
       title_en, title_romaji, title_native, title_norm,
       format, subtype, episodes, chapters, volumes,
       media_status, season, season_year, average_rating,
       popularity, genres, cover_url, synopsis, nsfw, media_type,
       updated_at, fetched_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_id) DO UPDATE SET
       title_en = excluded.title_en, title_romaji = excluded.title_romaji,
       title_native = excluded.title_native, title_norm = excluded.title_norm,
       format = excluded.format, subtype = excluded.subtype,
       episodes = excluded.episodes, chapters = excluded.chapters,
       volumes = excluded.volumes, media_status = excluded.media_status,
       season = excluded.season, season_year = excluded.season_year,
       average_rating = excluded.average_rating, popularity = excluded.popularity,
       genres = excluded.genres, cover_url = excluded.cover_url,
       synopsis = excluded.synopsis, nsfw = excluded.nsfw,
       media_type = excluded.media_type, updated_at = excluded.updated_at,
       fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
     RETURNING id`,
    values
  );

  // An upsert that takes the update branch leaves lastInsertRowid pointing
  // at some other row, so the id is read back rather than guessed.
  const mediaId = Number(result.rows && result.rows[0] && result.rows[0].id ? result.rows[0].id : 0)
    || await getMediaId(db, media.provider, media.providerId);

  await runWrite(db, 'INSERT OR REPLACE INTO media_id_map (provider, provider_id, media_id) VALUES (?, ?, ?)', [media.provider, media.providerId, mediaId]);
  await runWrite(db, 'DELETE FROM media_search_tokens WHERE media_id = ?', [mediaId]);
  await runWrite(db, 'DELETE FROM media_genre_tokens WHERE media_id = ?', [mediaId]);
  if (tokens.length) {
    await runWrite(
      db,
      'INSERT OR IGNORE INTO media_search_tokens (token, media_id) VALUES ' + tokens.map(() => '(?, ?)').join(', '),
      tokens.flatMap((token) => [token, mediaId])
    );
  }
  if (genreTokens.length) {
    await runWrite(
      db,
      'INSERT OR IGNORE INTO media_genre_tokens (genre, media_id) VALUES ' + genreTokens.map(() => '(?, ?)').join(', '),
      genreTokens.flatMap((genre) => [genre, mediaId])
    );
  }
  return mediaId;
}

/** The id of an existing snapshot row, by provider id. */
async function getMediaId(db, provider, providerId) {
  const row = await getRow(db, 'SELECT id FROM media WHERE provider = ? AND provider_id = ?', [provider, providerId]);
  return Number(row && row.id ? row.id : 0);
}

/** The statement that inserts or refreshes one snapshot row. */
function mediaUpsertStatement(media) {
  const at = nowIso();
  return {
    sql: `INSERT INTO media (
       provider, provider_id,
       title_en, title_romaji, title_native, title_norm,
       format, subtype, episodes, chapters, volumes,
       media_status, season, season_year, average_rating,
       popularity, genres, cover_url, synopsis, nsfw, media_type,
       updated_at, fetched_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_id) DO UPDATE SET
       title_en = excluded.title_en, title_romaji = excluded.title_romaji,
       title_native = excluded.title_native, title_norm = excluded.title_norm,
       format = excluded.format, subtype = excluded.subtype,
       episodes = excluded.episodes, chapters = excluded.chapters,
       volumes = excluded.volumes, media_status = excluded.media_status,
       season = excluded.season, season_year = excluded.season_year,
       average_rating = excluded.average_rating, popularity = excluded.popularity,
       genres = excluded.genres, cover_url = excluded.cover_url,
       synopsis = excluded.synopsis, nsfw = excluded.nsfw,
       media_type = excluded.media_type, updated_at = excluded.updated_at,
       fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
     RETURNING id`,
    args: [
      media.provider, media.providerId,
      media.titleEn, media.titleRomaji, media.titleNative, media.titleNorm,
      media.format, media.subtype, media.episodes, media.chapters, media.volumes,
      media.status, media.season, media.seasonYear, media.averageRating,
      media.popularity, media.genres, media.coverUrl, media.synopsis,
      media.nsfw ? 1 : 0, media.mediaType || null,
      media.updatedAt || null, at, media.expiresAt || null,
    ],
  };
}

/**
 * Write a whole page of titles in two round trips: one batch for the rows,
 * one batch for the id map and the token tables.
 *
 * Writing a row at a time cost about thirty statements per title, which
 * made the crawl statement-bound instead of network-bound. Returns the ids
 * of the written rows, in the order they were given.
 */
export async function writeMediaBatch(db, items) {
  if (!items.length) return [];
  const upserts = items.map(({ media }) => mediaUpsertStatement(media));
  const upsertResults = await db.batch(upserts, 'write');

  const ids = upsertResults.map((result) => {
    const row = result && result.rows && result.rows[0];
    return Number(row && row.id ? row.id : 0);
  });

  const statements = [];
  items.forEach(({ media, tokens = [], genreTokens = [] }, index) => {
    const mediaId = ids[index];
    if (!mediaId) return;
    statements.push({
      sql: 'INSERT OR REPLACE INTO media_id_map (provider, provider_id, media_id) VALUES (?, ?, ?)',
      args: [media.provider, media.providerId, mediaId],
    });
    statements.push({ sql: 'DELETE FROM media_search_tokens WHERE media_id = ?', args: [mediaId] });
    statements.push({ sql: 'DELETE FROM media_genre_tokens WHERE media_id = ?', args: [mediaId] });
    if (tokens.length) {
      statements.push({
        sql: 'INSERT OR IGNORE INTO media_search_tokens (token, media_id) VALUES ' + tokens.map(() => '(?, ?)').join(', '),
        args: tokens.flatMap((token) => [token, mediaId]),
      });
    }
    if (genreTokens.length) {
      statements.push({
        sql: 'INSERT OR IGNORE INTO media_genre_tokens (genre, media_id) VALUES ' + genreTokens.map(() => '(?, ?)').join(', '),
        args: genreTokens.flatMap((genre) => [genre, mediaId]),
      });
    }
  });
  if (statements.length) await db.batch(statements, 'write');
  return ids;
}

/** Snapshot rows for the writer: provider ids above the watermark, oldest first. */
export async function listMediaIdsForSync(db, provider, mediaType, afterId, limit) {
  const rows = await getRows(db, `
    SELECT provider_id FROM media
    WHERE provider = ? AND media_type = ?
      AND CAST(SUBSTR(provider_id, INSTR(provider_id, ':') + 1) AS INTEGER) > ?
    ORDER BY CAST(SUBSTR(provider_id, INSTR(provider_id, ':') + 1) AS INTEGER) ASC LIMIT ?
  `, [provider, mediaType, Number(afterId || 0), limit]);
  return rows.map((row) => row.provider_id);
}

export async function getSyncWatermark(db, provider, mediaType) {
  const row = await getRow(db, `
    SELECT MAX(CAST(SUBSTR(provider_id, INSTR(provider_id, ':') + 1) AS INTEGER)) AS mark
    FROM media WHERE provider = ? AND media_type = ?
  `, [provider, mediaType]);
  return Number(row && row.mark ? row.mark : 0);
}

/** Media whose snapshot has expired, so the writer refreshes them. */
export async function listStaleMedia(db, provider, mediaType, now, limit) {
  const rows = await getRows(db, `
    SELECT provider_id FROM media
    WHERE provider = ? AND media_type = ? AND (expires_at IS NULL OR expires_at <= ?)
    ORDER BY CAST(SUBSTR(provider_id, INSTR(provider_id, ':') + 1) AS INTEGER) ASC LIMIT ?
  `, [provider, mediaType, now, limit]);
  return rows.map((row) => row.provider_id);
}

export async function recordSyncRun(db, run) {
  return insert(db, 'catalogue_sync_runs', {
    provider: run.provider,
    media_type: run.mediaType || null,
    started_at: run.startedAt,
    finished_at: run.finishedAt || null,
    fetched: run.fetched || 0,
    updated: run.updated || 0,
    skipped: run.skipped || 0,
    mode: run.mode || null,
    cursor: run.cursor || 0,
    total: run.total == null ? null : run.total,
    error: run.error || null,
  });
}

export async function getLastSyncRun(db, provider, mediaType = null) {
  if (mediaType) {
    const row = await getRow(
      db,
      'SELECT * FROM catalogue_sync_runs WHERE provider = ? AND media_type = ? ORDER BY id DESC LIMIT 1',
      [provider, mediaType]
    );
    return row || null;
  }
  const row = await getRow(db, 'SELECT * FROM catalogue_sync_runs WHERE provider = ? ORDER BY id DESC LIMIT 1', [provider]);
  return row || null;
}

/** Where a sync run should continue: the crawl offset, or the refresh offset. */
export async function getCatalogueCursor(db, provider, mediaType, kind = 'crawl') {
  const row = await getRow(
    db,
    'SELECT cursor FROM catalogue_cursors WHERE provider = ? AND media_type = ? AND kind = ?',
    [provider, mediaType, kind]
  );
  return Number(row && row.cursor ? row.cursor : 0);
}

/** Remember where the next sync run continues. */
export async function setCatalogueCursor(db, provider, mediaType, kind, value) {
  await runWrite(
    db,
    `INSERT INTO catalogue_cursors (provider, media_type, kind, cursor, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (provider, media_type, kind) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`,
    [provider, mediaType, kind, Number(value) || 0, nowIso()]
  );
  return Number(value) || 0;
}

/* ------------------------------------------------------- library entries */

export const LIBRARY_STATUSES = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];

export async function upsertLibraryEntry(db, userId, entry) {
  const at = nowIso();
  const existing = await getRow(db, 'SELECT id FROM library_entries WHERE user_id = ? AND media_id = ?', [userId, entry.mediaId]);
  if (existing) {
    await runWrite(db, `
      UPDATE library_entries SET
        status = ?, progress = ?, score = ?, notes = ?, favourite = ?,
        rewatch_count = ?, started_at = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `, [
      entry.status, entry.progress, entry.score, entry.notes, entry.favourite ? 1 : 0,
      entry.rewatchCount || 0, entry.startedAt || null, entry.completedAt || null, at,
      existing.id,
    ]);
    return existing.id;
  }
  return insert(db, 'library_entries', {
    user_id: userId,
    media_id: entry.mediaId,
    status: entry.status || 'PLANNING',
    progress: entry.progress || 0,
    score: entry.score == null ? null : entry.score,
    notes: entry.notes || null,
    favourite: entry.favourite ? 1 : 0,
    rewatch_count: entry.rewatchCount || 0,
    started_at: entry.startedAt || null,
    completed_at: entry.completedAt || null,
    source: entry.source || 'local',
    remote_entry_id: entry.remoteEntryId || null,
    sync_state: entry.syncState || null,
    created_at: at,
    updated_at: at,
  });
}

export async function listLibraryEntries(db, userId, { limit = null, offset = 0, status = null, sort = 'updated' } = {}) {
  const where = ['e.user_id = ?'];
  const args = [userId];
  if (status) {
    where.push('e.status = ?');
    args.push(status);
  }
  // SQLite sorts NULLs last on a DESC order, which is what the score and
  // year sorts want (unrated titles at the bottom).
  const order = {
    updated: 'e.updated_at DESC',
    title: "LOWER(COALESCE(m.title_en, m.title_romaji, m.title_native, '')) ASC",
    status: 'e.status ASC',
    score: 'e.score DESC',
    year: 'm.season_year DESC',
  }[sort] || 'e.updated_at DESC';
  const paging = limit == null ? '' : ' LIMIT ? OFFSET ?';
  if (limit != null) args.push(Number(limit), Number(offset));
  const rows = await getRows(db, `
    SELECT e.*, m.title_en, m.title_romaji, m.title_native, m.cover_url, m.format,
           m.episodes, m.chapters, m.volumes, m.season_year, m.average_rating, m.genres
    FROM library_entries e JOIN media m ON m.id = e.media_id
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}${paging}
  `, args);
  return rows.map((row) => ({
    id: row.id,
    mediaId: row.media_id,
    title: row.title_en || row.title_romaji || row.title_native || 'Untitled',
    titleRomaji: row.title_romaji,
    coverUrl: row.cover_url,
    format: row.format,
    episodes: row.episodes,
    chapters: row.chapters,
    volumes: row.volumes,
    year: row.season_year,
    averageRating: row.average_rating,
    genres: safeJsonArray(row.genres),
    status: row.status,
    progress: row.progress,
    score: row.score,
    notes: row.notes,
    favourite: row.favourite === 1,
    rewatchCount: row.rewatch_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    source: row.source,
    updatedAt: row.updated_at,
  }));
}

export async function countLibraryEntries(db, userId, { status = null } = {}) {
  const where = ['user_id = ?'];
  const args = [userId];
  if (status) {
    where.push('status = ?');
    args.push(status);
  }
  const row = await getRow(db, `SELECT COUNT(*) AS n FROM library_entries WHERE ${where.join(' AND ')}`, args);
  return Number(row && row.n ? row.n : 0);
}

export async function getLibraryEntry(db, userId, id) {
  const row = await getRow(db, 'SELECT * FROM library_entries WHERE id = ? AND user_id = ?', [id, userId]);
  return row || null;
}

export async function deleteLibraryEntry(db, userId, id) {
  const result = await runWrite(db, 'DELETE FROM library_entries WHERE id = ? AND user_id = ?', [id, userId]);
  return Number(result.rowsAffected || 0) > 0;
}

export async function libraryStats(db, userId) {
  const rows = await getRows(db, `
    SELECT e.status, COUNT(*) AS n FROM library_entries e WHERE e.user_id = ? GROUP BY e.status
  `, [userId]);
  const byStatus = {};
  for (const row of rows) byStatus[row.status] = Number(row.n);
  const years = await getRows(db, `
    SELECT m.season_year AS year, COUNT(*) AS n
    FROM library_entries e JOIN media m ON m.id = e.media_id
    WHERE e.user_id = ? AND m.season_year IS NOT NULL
    GROUP BY m.season_year ORDER BY m.season_year DESC
  `, [userId]);
  const genres = await getRows(db, `
    SELECT m.genres FROM library_entries e JOIN media m ON m.id = e.media_id WHERE e.user_id = ?
  `, [userId]);
  const genreCounts = new Map();
  for (const row of genres) {
    for (const genre of safeJsonArray(row.genres)) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  return {
    total,
    byStatus,
    topGenres,
    byYear: years.map((row) => ({ year: Number(row.year), count: Number(row.n) })),
    completed: byStatus.COMPLETED || 0,
    watching: byStatus.CURRENT || 0,
    planned: byStatus.PLANNING || 0,
  };
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  return Number(result.rows[0].id);
}
