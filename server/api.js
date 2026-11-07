/**
 * Account API routes: register, login, logout, me, change password, delete
 * account, and sync endpoints for Wrapped preferences/templates and daily
 * guess progress.
 *
 * Answers plain JSON through the helpers in http.js. Every route is
 * independent of the static-site serving in server/index.js so the API can be
 * tested in isolation.
 */

import {
  HttpError,
  clearSessionCookie,
  csrfCookie,
  csrfToken,
  getSessionToken,
  json,
  randomToken,
  readJsonBody,
  requireCsrf,
  sessionCookie,
  sha256Hex,
  validateEmail,
  validatePassword,
  validateUsername,
  clientIp,
} from './http.js';
import { hashPassword, verifyPassword, dummyVerify } from './passwords.js';
import {
  createSession,
  createUser,
  deleteAllSessionsForUser,
  deleteSessionByTokenHash,
  deleteTemplate,
  deleteUser,
  getSessionByTokenHash,
  getUserByEmail,
  getUserById,
  getUserByUsername,
  listGuessProgress,
  listTemplates,
  loadWrappedPrefs,
  pruneExpiredSessions,
  saveGuessProgress,
  saveWrappedPrefs,
  touchLogin,
  updateUserPassword,
  upsertTemplate,
  countActiveSessions,
} from './db.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_SECONDS = Math.floor(SESSION_LIFETIME_MS / 1000);

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.created_at,
  };
}

function toUserSafe(row) {
  const { password_hash: _omitted, ...safe } = row;
  return publicUser(safe);
}

function resolveSession(db, req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = getSessionByTokenHash(db, sha256Hex(token));
  if (!session) return null;
  const user = getUserById(db, session.user_id);
  if (!user) return null;
  return { user, session, token };
}

function requireSession(db, req) {
  const resolved = resolveSession(db, req);
  if (!resolved) throw new HttpError(401, 'You need to log in first.');
  return resolved;
}

function issueSession(db, req, res, user) {
  const token = randomToken(32);
  pruneExpiredSessions(db);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  createSession(db, {
    userId: user.id,
    tokenHash: sha256Hex(token),
    expiresAt,
    userAgent: req.headers['user-agent'] || null,
    ip: clientIp(req),
  });
  touchLogin(db, user.id);
  const csrf = csrfToken();
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    sessionCookie(token, { secure, maxAgeSeconds: SESSION_LIFETIME_SECONDS }),
    csrfCookie(csrf, { secure, maxAgeSeconds: SESSION_LIFETIME_SECONDS }),
  ]);
  return csrf;
}

function destroySession(db, req, res) {
  const token = getSessionToken(req);
  if (token) deleteSessionByTokenHash(db, sha256Hex(token));
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', clearSessionCookie({ secure }));
}

/**
 * Build the API router. dependencies: { db, authLimiters } — split out so the
 * server entry and the tests construct the same routes the same way.
 */
export function createApiRouter({ db, registerLimiter, loginLimiter }) {

  async function register(req, res) {
    const gate = registerLimiter.consume(clientIp(req));
    if (!gate.allowed) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');

    const body = await readJsonBody(req);
    const username = validateUsername(body.username);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);
    const fields = {};
    if (username.error) fields.username = username.error;
    if (email.error) fields.email = email.error;
    if (password.error) fields.password = password.error;
    if (Object.keys(fields).length > 0) {
      throw new HttpError(400, 'Check the highlighted fields.', { fields });
    }

    if (getUserByUsername(db, username.value)) {
      throw new HttpError(409, 'That username is already taken.', { field: 'username' });
    }
    if (getUserByEmail(db, email.value)) {
      throw new HttpError(409, 'An account with that email already exists.', { field: 'email' });
    }

    const user = createUser(db, {
      username: username.value,
      email: email.value,
      passwordHash: hashPassword(password.value),
    });
    issueSession(db, req, res, user);
    json(res, 201, { user: publicUser(user) });
  }

  async function login(req, res) {
    const body = await readJsonBody(req);
    const identifier = String(body.identifier == null ? '' : body.identifier).trim();
    const password = String(body.password == null ? '' : body.password);
    if (!identifier || !password) {
      throw new HttpError(400, 'Enter your username or email and password.');
    }

    const gate = loginLimiter.consume(clientIp(req) + ':' + identifier.toLowerCase());
    if (!gate.allowed) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');

    const user = identifier.includes('@')
      ? getUserByEmail(db, identifier)
      : getUserByUsername(db, identifier);

    if (!user) {
      dummyVerify(password); // equalize timing
      throw new HttpError(401, 'Those credentials do not match any account.');
    }
    if (!verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Those credentials do not match any account.');
    }

    issueSession(db, req, res, user);
    json(res, 200, { user: publicUser(user) });
  }

  async function logout(req, res) {
    destroySession(db, req, res);
    json(res, 200, { ok: true });
  }

  async function me(req, res) {
    const resolved = resolveSession(db, req);
    if (!resolved) {
      json(res, 200, { user: null });
      return;
    }
    const activeSessions = countActiveSessions(db, resolved.user.id);
    json(res, 200, { user: publicUser(resolved.user), activeSessions });
  }

  async function changePassword(req, res) {
    requireCsrf(req);
    const { user } = requireSession(db, req);
    const body = await readJsonBody(req);
    const current = validatePassword(String(body.currentPassword == null ? '' : body.currentPassword));
    if (body.currentPassword == null || String(body.currentPassword) === '') {
      throw new HttpError(400, 'Enter your current password.', { field: 'currentPassword' });
    }
    if (current.error) {
      throw new HttpError(400, current.error, { field: 'currentPassword' });
    }
    if (!verifyPassword(String(body.currentPassword), user.password_hash)) {
      throw new HttpError(403, 'That is not your current password.', { field: 'currentPassword' });
    }
    const next = validatePassword(body.newPassword);
    if (next.error) throw new HttpError(400, next.error, { field: 'newPassword' });
    if (verifyPassword(next.value, user.password_hash)) {
      throw new HttpError(400, 'Choose a password you have not used on this account.', { field: 'newPassword' });
    }
    updateUserPassword(db, user.id, hashPassword(next.value));
    deleteAllSessionsForUser(db, user.id); // every device signs out; this one re-issues below
    issueSession(db, req, res, user);
    json(res, 200, { ok: true });
  }

  async function deleteAccount(req, res) {
    requireCsrf(req);
    const { user } = requireSession(db, req);
    const body = await readJsonBody(req);
    if (!verifyPassword(String(body.password == null ? '' : body.password), user.password_hash)) {
      throw new HttpError(403, 'Enter your password to delete your account.', { field: 'password' });
    }
    deleteUser(db, user.id);
    destroySession(db, req, res);
    json(res, 200, { ok: true });
  }

  function shapePrefs(payload) {
    if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Preferences must be a JSON object.');
    if (JSON.stringify(payload).length > 64 * 1024) throw new HttpError(413, 'Preferences are too large.');
    return payload;
  }

  async function wrappedPrefs(req, res) {
    const { user } = requireSession(db, req);
    if (req.method === 'GET') {
      const saved = loadWrappedPrefs(db, user.id);
      json(res, 200, { prefs: saved ? saved.payload : null, updatedAt: saved ? saved.updatedAt : null });
      return;
    }
    requireCsrf(req);
    const body = await readJsonBody(req);
    const prefs = shapePrefs(body.prefs);
    saveWrappedPrefs(db, user.id, prefs);
    json(res, 200, { ok: true });
  }

  async function templates(req, res, parts) {
    const { user } = requireSession(db, req);
    if (parts.length === 0) {
      if (req.method === 'GET') {
        json(res, 200, { templates: listTemplates(db, user.id) });
        return;
      }
      requireCsrf(req);
      const body = await readJsonBody(req);
      const name = String(body.name == null ? '' : body.name).trim();
      if (!name || name.length > 64) throw new HttpError(400, 'Template names need 1–64 characters.', { field: 'name' });
      if (!body.payload || typeof body.payload !== 'object') throw new HttpError(400, 'Template payload must be a JSON object.');
      if (JSON.stringify(body.payload).length > 128 * 1024) throw new HttpError(413, 'Template is too large.');
      upsertTemplate(db, user.id, { name, payload: body.payload });
      json(res, 200, { ok: true, name });
      return;
    }
    if (parts.length === 1 && req.method === 'DELETE') {
      requireCsrf(req);
      deleteTemplate(db, user.id, decodeURIComponent(parts[0]));
      json(res, 200, { ok: true });
      return;
    }
    throw new HttpError(404, 'Unknown endpoint.');
  }

  async function guess(req, res) {
    const { user } = requireSession(db, req);
    if (req.method === 'GET') {
      const mediaType = new URL(req.url, 'http://placeholder').searchParams.get('media');
      json(res, 200, { progress: listGuessProgress(db, user.id, mediaType || null) });
      return;
    }
    requireCsrf(req);
    const body = await readJsonBody(req);
    const mediaType = body.mediaType === 'manga' ? 'manga' : 'anime';
    if (!Number.isInteger(body.dayIndex) || body.dayIndex < 0) {
      throw new HttpError(400, 'dayIndex must be a non-negative integer.');
    }
    const score = Number.isInteger(body.score) ? body.score : 0;
    saveGuessProgress(db, user.id, { mediaType, dayIndex: body.dayIndex, score, won: body.won === true });
    json(res, 200, { ok: true });
  }

  const routes = new Map([
    ['/api/auth/register', { POST: register }],
    ['/api/auth/login', { POST: login }],
    ['/api/auth/logout', { POST: logout }],
    ['/api/auth/me', { GET: me }],
    ['/api/auth/password', { POST: changePassword }],
    ['/api/auth/account', { DELETE: deleteAccount }],
    ['/api/sync/wrapped-prefs', { GET: wrappedPrefs, POST: wrappedPrefs }],
    ['/api/sync/guess', { GET: guess, POST: guess }],
  ]);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://placeholder');
    const pathname = url.pathname;

    if (pathname === '/api/sync/templates' || pathname.startsWith('/api/sync/templates/')) {
      const rest = pathname.slice('/api/sync/templates'.length).split('/').filter(Boolean);
      await templates(req, res, rest);
      return;
    }

    const entry = routes.get(pathname);
    if (!entry) throw new HttpError(404, 'Unknown endpoint.');
    const handler = entry[req.method];
    if (!handler) throw new HttpError(405, 'That method is not supported here.');
    await handler(req, res);
  }

  return { handle, publicUser: toUserSafe, resolveSession };
}
