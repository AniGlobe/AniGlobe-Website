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
import { resetPasswordMail, verifyEmailMail, sendMail, originOf } from './mail.js';
import {
  createResetToken,
  createSession,
  createUser,
  createVerifyToken,
  deleteAllSessionsForUser,
  deleteSessionByTokenHash,
  deleteTemplate,
  deleteUser,
  findResetToken,
  findVerifyToken,
  getSessionByTokenHash,
  getUserByEmail,
  getUserById,
  getUserByUsername,
  isSessionIdle,
  listGuessProgress,
  listSessionsForUser,
  listTemplates,
  loadWrappedPrefs,
  markEmailVerified,
  pruneExpiredSessions,
  saveGuessProgress,
  saveWrappedPrefs,
  touchLogin,
  touchSession,
  updateUserPassword,
  upsertTemplate,
  useResetToken,
  useVerifyToken,
  countActiveSessions,
  getSessionById,
} from './db.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_SECONDS = Math.floor(SESSION_LIFETIME_MS / 1000);
const RESET_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const VERIFY_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Structured security events (JSON to stderr). The database never logs secrets. */
function logEvent(event, fields = {}) {
  process.stderr.write(`[aniglobe-security] ${JSON.stringify({ event, ts: new Date().toISOString(), ...fields })}\n`);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.created_at,
    verified: Boolean(user.email_verified_at),
  };
}

function toUserSafe(row) {
  const { password_hash: _omitted, ...safe } = row;
  return publicUser(safe);
}

let lastTouchAt = 0;

function resolveSession(db, req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = getSessionByTokenHash(db, sha256Hex(token));
  if (!session) return null;
  if (isSessionIdle(db, session, SESSION_IDLE_MS)) {
    deleteSessionByTokenHash(db, sha256Hex(token));
    return null;
  }
  const user = getUserById(db, session.user_id);
  if (!user) return null;
  // Slide the idle window, at most once every five minutes per process.
  const current = Date.now();
  if (!session.last_seen_at || current - lastTouchAt > 5 * 60 * 1000) {
    lastTouchAt = current;
    touchSession(db, session.id, new Date(current).toISOString());
  }
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
export function createApiRouter({ db, registerLimiter, loginLimiter, resetLimiter, mailer = sendMail }) {

  function mailVerifyToken(req, user, token) {
    const url = `${originOf(req)}#/verify?token=${encodeURIComponent(token)}`;
    return mailer(verifyEmailMail(user.email, url));
  }

  function issueVerifyToken(req, user) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_LIFETIME_MS).toISOString();
    createVerifyToken(db, user.id, sha256Hex(token), expiresAt);
    return token;
  }

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
    const token = issueVerifyToken(req, user);
    mailVerifyToken(req, user, token).catch((error) => logEvent('verify_mail_failed', { userId: user.id, error: error.message }));
    logEvent('register', { userId: user.id, ip: clientIp(req) });
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
      logEvent('login_failed', { identifier: identifier.slice(0, 32), reason: 'no_such_user', ip: clientIp(req) });
      throw new HttpError(401, 'Those credentials do not match any account.');
    }
    if (!verifyPassword(password, user.password_hash)) {
      logEvent('login_failed', { userId: user.id, reason: 'wrong_password', ip: clientIp(req) });
      throw new HttpError(401, 'Those credentials do not match any account.');
    }

    logEvent('login_success', { userId: user.id, ip: clientIp(req) });
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
    logEvent('password_changed', { userId: user.id });
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
    logEvent('account_deleted', { userId: user.id });
    destroySession(db, req, res);
    json(res, 200, { ok: true });
  }

  async function resetRequest(req, res) {
    // Always answers 200 — revealing whether an email exists would hand out
    // a user-enumeration oracle.
    const body = await readJsonBody(req);
    const email = validateEmail(body.email);
    if (email.error) {
      json(res, 200, { ok: true });
      return;
    }
    const gate = resetLimiter.consume(clientIp(req) + ':' + email.value);
    if (!gate.allowed) {
      json(res, 200, { ok: true });
      return;
    }
    const user = getUserByEmail(db, email.value);
    if (user) {
      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_LIFETIME_MS).toISOString();
      createResetToken(db, user.id, sha256Hex(token), expiresAt);
      const url = `${originOf(req)}#/reset?token=${encodeURIComponent(token)}`;
      mailer(resetPasswordMail(user.email, url)).catch((error) => logEvent('reset_mail_failed', { userId: user.id, error: error.message }));
      logEvent('password_reset_requested', { userId: user.id });
    }
    json(res, 200, { ok: true });
  }

  async function resetConfirm(req, res) {
    const body = await readJsonBody(req);
    const token = String(body.token == null ? '' : body.token).trim();
    if (!token) throw new HttpError(400, 'Include the reset token from your email.');
    const row = findResetToken(db, sha256Hex(token));
    if (!row || row.used_at !== null || row.expires_at < new Date().toISOString()) {
      logEvent('password_reset_failed', { reason: row ? 'expired_or_used' : 'unknown_token' });
      throw new HttpError(400, 'This reset link is invalid or expired. Request a new one.');
    }
    const next = validatePassword(body.newPassword);
    if (next.error) throw new HttpError(400, next.error, { field: 'newPassword' });
    updateUserPassword(db, row.user_id, hashPassword(next.value));
    useResetToken(db, sha256Hex(token));
    markEmailVerified(db, row.user_id);
    deleteAllSessionsForUser(db, row.user_id);
    logEvent('password_reset_completed', { userId: row.user_id });
    json(res, 200, { ok: true });
  }

  async function verifyConfirm(req, res) {
    const body = await readJsonBody(req);
    const token = String(body.token == null ? '' : body.token).trim();
    if (!token) throw new HttpError(400, 'Include the verification token from your email.');
    const row = findVerifyToken(db, sha256Hex(token));
    if (!row || row.used_at !== null || row.expires_at < new Date().toISOString()) {
      logEvent('verify_failed', { reason: row ? 'expired_or_used' : 'unknown_token' });
      throw new HttpError(400, 'This verification link is invalid or expired. Request a new one.');
    }
    markEmailVerified(db, row.user_id);
    useVerifyToken(db, sha256Hex(token));
    logEvent('verify_completed', { userId: row.user_id });
    json(res, 200, { ok: true });
  }

  async function verifyResend(req, res) {
    requireCsrf(req);
    const { user } = requireSession(db, req);
    if (user.email_verified_at) {
      json(res, 200, { ok: true });
      return;
    }
    const gate = resetLimiter.consume('verify:' + user.id);
    if (!gate.allowed) {
      json(res, 200, { ok: true });
      return;
    }
    const token = issueVerifyToken(req, user);
    mailVerifyToken(req, user, token).catch((error) => logEvent('verify_resend_failed', { userId: user.id, error: error.message }));
    json(res, 200, { ok: true });
  }

  async function listSessions(req, res) {
    const { user, session } = requireSession(db, req);
    const rows = listSessionsForUser(db, user.id);
    json(res, 200, {
      sessions: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        ip: row.ip,
        userAgent: row.user_agent,
        current: row.id === session.id,
      })),
    });
  }

  async function revokeSession(req, res, id) {
    requireCsrf(req);
    const { user } = requireSession(db, req);
    const target = getSessionById(db, Number(id));
    if (!target || target.user_id !== user.id) throw new HttpError(404, 'That session does not exist.');
    deleteSessionByTokenHash(db, target.token_hash);
    logEvent('session_revoked', { userId: user.id, sessionId: target.id });
    json(res, 200, { ok: true });
  }

  async function revokeAllSessions(req, res) {
    requireCsrf(req);
    const { user } = requireSession(db, req);
    deleteAllSessionsForUser(db, user.id);
    logEvent('sessions_revoked_all', { userId: user.id });
    const secure = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', clearSessionCookie({ secure }));
    json(res, 200, { ok: true });
  }

  async function dataExport(req, res) {
    const { user } = requireSession(db, req);
    const prefs = loadWrappedPrefs(db, user.id);
    res.setHeader('Content-Disposition', `attachment; filename="aniglobe-export-${user.username.toLowerCase()}.json"`);
    json(res, 200, {
      exportedAt: new Date().toISOString(),
      user: publicUser(user),
      wrappedPrefs: prefs ? prefs.payload : null,
      templates: listTemplates(db, user.id),
      guessProgress: listGuessProgress(db, user.id),
      activeSessionCount: countActiveSessions(db, user.id),
    });
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
    ['/api/auth/password-reset/request', { POST: resetRequest }],
    ['/api/auth/password-reset/confirm', { POST: resetConfirm }],
    ['/api/auth/verify/confirm', { POST: verifyConfirm }],
    ['/api/auth/verify/resend', { POST: verifyResend }],
    ['/api/auth/sessions', { GET: listSessions }],
    ['/api/auth/sessions/revoke-all', { POST: revokeAllSessions }],
    ['/api/auth/export', { GET: dataExport }],
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

    if (pathname === '/api/auth/sessions/revoke-all' || pathname.startsWith('/api/auth/sessions/')) {
      const idPart = pathname.slice('/api/auth/sessions/'.length);
      const match = idPart.match(/^(\d+)$/);
      if (match && req.method === 'DELETE') {
        const { user } = requireSession(db, req);
        requireCsrf(req);
        const target = getSessionById(db, Number(match[1]));
        if (!target || target.user_id !== user.id) throw new HttpError(404, 'That session does not exist.');
        deleteSessionByTokenHash(db, target.token_hash);
        logEvent('session_revoked', { userId: user.id, sessionId: target.id });
        json(res, 200, { ok: true });
        return;
      }
      if (pathname === '/api/auth/sessions/revoke-all' && req.method === 'POST') {
        await revokeAllSessions(req, res);
        return;
      }
      throw new HttpError(404, 'Unknown endpoint.');
    }

    const entry = routes.get(pathname);
    if (!entry) throw new HttpError(404, 'Unknown endpoint.');
    const handler = entry[req.method];
    if (!handler) throw new HttpError(405, 'That method is not supported here.');
    await handler(req, res);
  }

  return { handle, publicUser: toUserSafe, resolveSession };
}
