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
  clearCsrfCookie,
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
import { catalogueProviderId, cronSecret } from './catalogue-config.js';
import {
  getLastSyncRun,
  getLibraryEntry,
  getMediaById,
  LIBRARY_STATUSES,
  deleteLibraryEntry,
  libraryStats,
  listLibraryEntries,
  upsertLibraryEntry,
} from './db.js';
import { getSnapshotMedia, runCatalogueSync, searchSnapshot } from './catalogue-store.js';
import { googleEnabled, GOOGLE_PROVIDER, callbackUrl, googleAuthorizationUrl, exchangeGoogleCode } from './oauth.js';
import { currentStreak, bestStreak } from '../../src/domain/streak.js';
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
  updateProfile,
  guessSummary,
  setTemplatePublic,
  listPublicTemplates,
  getPublicTemplateById,
  setTemplateLike,
  getUserByOAuth,
  linkOAuth,
  unlinkOAuth,
  createOAuthState,
  findOAuthState,
  useOAuthState,
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
const BIO_MAX_CHARS = 280;
const AVATAR_MAX_BYTES = 150 * 1024;
const AVATAR_MIME_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

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
    oauthProvider: user.oauth_provider || null,
  };
}

function toUserSafe(row) {
  const { password_hash: _omitted, ...safe } = row;
  return publicUser(safe);
}

async function resolveSession(db, req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const session = await getSessionByTokenHash(db, tokenHash);
  if (!session) return null;
  if (isSessionIdle(db, session, SESSION_IDLE_MS)) {
    await deleteSessionByTokenHash(db, tokenHash);
    return null;
  }
  const user = await getUserById(db, session.user_id);
  if (!user) return null;
  // Slide the idle window per session, at most once every five minutes.
  // (A single process-global timer would starve every other user's touch.)
  const current = Date.now();
  const lastSeen = Date.parse(session.last_seen_at || session.created_at || '');
  if (Number.isNaN(lastSeen) || current - lastSeen > 5 * 60 * 1000) {
    await touchSession(db, session.id, new Date(current).toISOString());
  }
  return { user, session, token };
}

async function requireSession(db, req) {
  const resolved = await resolveSession(db, req);
  if (!resolved) throw new HttpError(401, 'You need to log in first.');
  return resolved;
}

async function issueSession(db, req, res, user) {
  const token = randomToken(32);
  await pruneExpiredSessions(db);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  await createSession(db, {
    userId: user.id,
    tokenHash: sha256Hex(token),
    expiresAt,
    userAgent: req.headers['user-agent'] || null,
    ip: clientIp(req),
  });
  await touchLogin(db, user.id);
  const csrf = csrfToken();
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [
    sessionCookie(token, { secure, maxAgeSeconds: SESSION_LIFETIME_SECONDS }),
    csrfCookie(csrf, { secure, maxAgeSeconds: SESSION_LIFETIME_SECONDS }),
  ]);
  return csrf;
}

async function destroySession(db, req, res) {
  const token = getSessionToken(req);
  if (token) await deleteSessionByTokenHash(db, sha256Hex(token));
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', [clearSessionCookie({ secure }), clearCsrfCookie({ secure })]);
}

/**
 * Build the API router. dependencies: { db, authLimiters } — split out so the
 * server entry and the tests construct the same routes the same way.
 */
export function createApiRouter({ db, registerLimiter, loginLimiter, resetLimiter, mailer = sendMail, oauth = null }) {

  function mailVerifyToken(req, user, token) {
    const url = `${originOf(req)}#/verify?token=${encodeURIComponent(token)}`;
    return mailer(verifyEmailMail(user.email, url));
  }

  async function issueVerifyToken(req, user) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_LIFETIME_MS).toISOString();
    await createVerifyToken(db, user.id, sha256Hex(token), expiresAt);
    return token;
  }

  async function register(req, res) {
    const gate = await registerLimiter.consume(clientIp(req));
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

    if (await getUserByUsername(db, username.value)) {
      throw new HttpError(409, 'That username is already taken.', { field: 'username' });
    }
    if (await getUserByEmail(db, email.value)) {
      throw new HttpError(409, 'An account with that email already exists.', { field: 'email' });
    }

    const user = await createUser(db, {
      username: username.value,
      email: email.value,
      passwordHash: hashPassword(password.value),
    });
    const token = await issueVerifyToken(req, user);
    // Awaited, not fire-and-forget: on serverless (Vercel) the instance can
    // freeze right after the response, silently killing an in-flight send.
    await mailVerifyToken(req, user, token).catch((error) => logEvent('verify_mail_failed', { userId: user.id, error: error.message }));
    logEvent('register', { userId: user.id, ip: clientIp(req) });
    await issueSession(db, req, res, user);
    json(res, 201, { user: publicUser(user) });
  }

  async function login(req, res) {
    const body = await readJsonBody(req);
    const identifier = String(body.identifier == null ? '' : body.identifier).trim();
    const password = String(body.password == null ? '' : body.password);
    if (!identifier || !password) {
      throw new HttpError(400, 'Enter your username or email and password.');
    }

    const gate = await loginLimiter.consume(clientIp(req) + ':' + sha256Hex(identifier.toLowerCase()));
    if (!gate.allowed) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');

    const user = identifier.includes('@')
      ? await getUserByEmail(db, identifier)
      : await getUserByUsername(db, identifier);

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
    await issueSession(db, req, res, user);
    json(res, 200, { user: publicUser(user) });
  }

  async function logout(req, res) {
    // Require CSRF when a session exists (logout-CSRF); anonymous logout stays idempotent.
    if (getSessionToken(req)) requireCsrf(req);
    await destroySession(db, req, res);
    json(res, 200, { ok: true });
  }

  async function me(req, res) {
    const resolved = await resolveSession(db, req);
    if (!resolved) {
      json(res, 200, { user: null });
      return;
    }
    const activeSessions = await countActiveSessions(db, resolved.user.id);
    json(res, 200, { user: publicUser(resolved.user), activeSessions });
  }

  async function changePassword(req, res) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    const body = await readJsonBody(req);
    const currentValue = body.currentPassword == null ? '' : String(body.currentPassword);
    if (currentValue === '') {
      throw new HttpError(400, 'Enter your current password.', { field: 'currentPassword' });
    }
    // Do not re-run the new-password policy on the current password: an older
    // valid password must still verify even if the policy has tightened.
    if (!verifyPassword(currentValue, user.password_hash)) {
      throw new HttpError(403, 'That is not your current password.', { field: 'currentPassword' });
    }
    const next = validatePassword(body.newPassword);
    if (next.error) throw new HttpError(400, next.error, { field: 'newPassword' });
    if (verifyPassword(next.value, user.password_hash)) {
      throw new HttpError(400, 'Choose a password you have not used on this account.', { field: 'newPassword' });
    }
    await updateUserPassword(db, user.id, hashPassword(next.value));
    await deleteAllSessionsForUser(db, user.id); // every device signs out; this one re-issues below
    logEvent('password_changed', { userId: user.id });
    await issueSession(db, req, res, user);
    json(res, 200, { ok: true });
  }

  async function deleteAccount(req, res) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    const body = await readJsonBody(req);
    if (!verifyPassword(String(body.password == null ? '' : body.password), user.password_hash)) {
      throw new HttpError(403, 'Enter your password to delete your account.', { field: 'password' });
    }
    await deleteUser(db, user.id);
    logEvent('account_deleted', { userId: user.id });
    await destroySession(db, req, res);
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
    const gate = await resetLimiter.consume(clientIp(req) + ':' + sha256Hex(email.value));
    if (!gate.allowed) {
      json(res, 200, { ok: true });
      return;
    }
    const user = await getUserByEmail(db, email.value);
    if (user) {
      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + RESET_TOKEN_LIFETIME_MS).toISOString();
      await createResetToken(db, user.id, sha256Hex(token), expiresAt);
      const url = `${originOf(req)}#/reset?token=${encodeURIComponent(token)}`;
      // Awaited for the same serverless reason as the register send above.
      await mailer(resetPasswordMail(user.email, url)).catch((error) => logEvent('reset_mail_failed', { userId: user.id, error: error.message }));
      logEvent('password_reset_requested', { userId: user.id });
    }
    json(res, 200, { ok: true });
  }

  async function resetConfirm(req, res) {
    const body = await readJsonBody(req);
    const token = String(body.token == null ? '' : body.token).trim();
    if (!token) throw new HttpError(400, 'Include the reset token from your email.');
    const row = await findResetToken(db, sha256Hex(token));
    if (!row || row.used_at !== null || row.expires_at < new Date().toISOString()) {
      logEvent('password_reset_failed', { reason: row ? 'expired_or_used' : 'unknown_token' });
      throw new HttpError(400, 'This reset link is invalid or expired. Request a new one.');
    }
    const next = validatePassword(body.newPassword);
    if (next.error) throw new HttpError(400, next.error, { field: 'newPassword' });
    await updateUserPassword(db, row.user_id, hashPassword(next.value));
    await useResetToken(db, sha256Hex(token));
    await markEmailVerified(db, row.user_id);
    await deleteAllSessionsForUser(db, row.user_id);
    logEvent('password_reset_completed', { userId: row.user_id });
    json(res, 200, { ok: true });
  }

  async function verifyConfirm(req, res) {
    const body = await readJsonBody(req);
    const token = String(body.token == null ? '' : body.token).trim();
    if (!token) throw new HttpError(400, 'Include the verification token from your email.');
    const row = await findVerifyToken(db, sha256Hex(token));
    if (!row || row.used_at !== null || row.expires_at < new Date().toISOString()) {
      logEvent('verify_failed', { reason: row ? 'expired_or_used' : 'unknown_token' });
      throw new HttpError(400, 'This verification link is invalid or expired. Request a new one.');
    }
    await markEmailVerified(db, row.user_id);
    await useVerifyToken(db, sha256Hex(token));
    logEvent('verify_completed', { userId: row.user_id });
    json(res, 200, { ok: true });
  }

  async function verifyResend(req, res) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    if (user.email_verified_at) {
      json(res, 200, { ok: true });
      return;
    }
    const gate = await resetLimiter.consume('verify:' + user.id);
    if (!gate.allowed) {
      json(res, 200, { ok: true });
      return;
    }
    const token = await issueVerifyToken(req, user);
    // Awaited — see the register send for why fire-and-forget dies on serverless.
    await mailVerifyToken(req, user, token).catch((error) => logEvent('verify_resend_failed', { userId: user.id, error: error.message }));
    json(res, 200, { ok: true });
  }

  const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;

  function oauthProviders() {
    if (oauth) return [{ provider: GOOGLE_PROVIDER, enabled: true }];
    return [{ provider: GOOGLE_PROVIDER, enabled: googleEnabled() }];
  }

  async function oauthProvidersRoute(req, res) {
    json(res, 200, { providers: oauthProviders() });
  }

  async function oauthStart(req, res) {
    if (!oauth && !googleEnabled()) throw new HttpError(501, 'Google sign-in is not configured.');
    const url = new URL(req.url, 'http://placeholder');
    const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login';
    const { randomBytes, createHash } = await import('node:crypto');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');
    const stateHash = createHash('sha256').update(state).digest('hex');
    const expiresAt = new Date(Date.now() + OAUTH_STATE_LIFETIME_MS).toISOString();
    let linkedUserId = null;
    if (mode === 'link') {
      const { user } = await requireSession(db, req);
      linkedUserId = user.id;
    }
    await createOAuthState(db, { stateHash, codeVerifier: verifier, userId: linkedUserId, mode, expiresAt });
    const redirectUri = callbackUrl(req);
    const authUrl = oauth && typeof oauth.authorizationUrl === 'function'
      ? await oauth.authorizationUrl({ redirectUri, state, codeChallenge: challenge })
      : await googleAuthorizationUrl(redirectUri, { state, codeChallenge: challenge });
    res.writeHead(302, { Location: authUrl, 'Cache-Control': 'no-store' });
    res.end();
  }

  async function oauthCallback(req, res) {
    const url = new URL(req.url, 'http://placeholder');
    const code = String(url.searchParams.get('code') || '');
    const state = String(url.searchParams.get('state') || '');
    const done = (ok) => {
      if (res.headersSent) return;
      const target = originOf(req) + '#/account?oauth=' + (ok ? 'ok' : 'error');
      res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
      res.end();
    };
    if (!code || !state) return done(false);
    let row;
    try {
      const { createHash } = await import('node:crypto');
      row = await findOAuthState(db, createHash('sha256').update(state).digest('hex'));
    } catch (error) {
      logEvent('oauth_callback_failed', { reason: 'db', error: error && error.message ? String(error.message).slice(0, 80) : 'unknown' });
      return done(false);
    }
    if (!row || row.used_at !== null || row.expires_at < new Date().toISOString()) {
      logEvent('oauth_callback_failed', { reason: row ? 'expired_or_used' : 'unknown_state' });
      return done(false);
    }
    let info;
    try {
      const { createHash } = await import('node:crypto');
      await useOAuthState(db, createHash('sha256').update(state).digest('hex'));
      const redirectUri = callbackUrl(req);
      info = oauth && typeof oauth.exchange === 'function'
        ? await oauth.exchange({ redirectUri, code, codeVerifier: row.code_verifier })
        : await exchangeGoogleCode(redirectUri, { code, codeVerifier: row.code_verifier });
    } catch (error) {
      logEvent('oauth_exchange_failed', { error: error && error.message ? String(error.message).slice(0, 80) : 'unknown' });
      return done(false);
    }
    const sub = String(info.sub || '');
    const email = String(info.email || '').toLowerCase();
    const emailVerified = info.email_verified === true || info.email_verified === 'true';
    if (!sub || !email) return done(false);

    if (row.mode === 'link' && row.user_id) {
      const target = await getUserById(db, row.user_id);
      if (!target) return done(false);
      if (target.oauth_subject && target.oauth_subject !== sub) return done(false);
      await linkOAuth(db, target.id, GOOGLE_PROVIDER, sub);
      logEvent('oauth_linked', { userId: target.id });
      return done(true);
    }
    let user = await getUserByOAuth(db, GOOGLE_PROVIDER, sub);
    if (user) {
      await issueSession(db, req, res, user);
      logEvent('oauth_login', { userId: user.id });
      return done(true);
    }
    user = await getUserByEmail(db, email);
    if (user) {
      if (!emailVerified && !user.email_verified_at) return done(false);
      await linkOAuth(db, user.id, GOOGLE_PROVIDER, sub);
      if (emailVerified) await markEmailVerified(db, user.id);
      await issueSession(db, req, res, user);
      logEvent('oauth_linked_login', { userId: user.id });
      return done(true);
    }
    const base = email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24) || 'user';
    let username = base;
    let suffix = 1;
    while (await getUserByUsername(db, username)) {
      suffix += 1;
      username = (base + suffix).slice(0, 32);
    }
    const placeholderHash = hashPassword(randomToken(32));
    user = await createUser(db, { username, email, passwordHash: placeholderHash });
    await linkOAuth(db, user.id, GOOGLE_PROVIDER, sub);
    if (emailVerified) await markEmailVerified(db, user.id);
    const vt = await issueVerifyToken({ headers: {} }, user);
    await mailVerifyToken(req, user, vt).catch(() => {});
    await issueSession(db, req, res, user);
    logEvent('oauth_registered', { userId: user.id });
    return done(true);
  }

  async function oauthUnlink(req, res) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    if (!user.oauth_provider) throw new HttpError(400, 'Google sign-in is not linked.');
    // Unlink always requires the account password, so an OAuth-only account
    // (placeholder hash) can never be unlinked into a lockout.
    const body = await readJsonBody(req);
    const password = body && body.password != null ? String(body.password) : '';
    if (!password || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(403, 'Enter your password to unlink Google.', { field: 'password' });
    }
    await unlinkOAuth(db, user.id);
    logEvent('oauth_unlinked', { userId: user.id });
    json(res, 200, { ok: true });
  }

  async function listSessions(req, res) {
    const { user, session } = await requireSession(db, req);
    const rows = await listSessionsForUser(db, user.id);
    json(res, 200, {
      sessions: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
        ip: row.ip,
        userAgent: row.user_agent,
        current: row.id === session.id,
      })),
    });
  }

  async function revokeSession(req, res, id) {
    // Single implementation used by the /:id route in handle().
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    const target = await getSessionById(db, Number(id));
    if (!target || target.user_id !== user.id) throw new HttpError(404, 'That session does not exist.');
    await deleteSessionByTokenHash(db, target.token_hash);
    logEvent('session_revoked', { userId: user.id, sessionId: target.id });
    json(res, 200, { ok: true });
  }
  // Note: handle() calls this helper directly; the routes map cannot express
  // parameterised paths, so keep the logic in one place.

  async function revokeAllSessions(req, res) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    await deleteAllSessionsForUser(db, user.id);
    logEvent('sessions_revoked_all', { userId: user.id });
    const secure = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', [clearSessionCookie({ secure }), clearCsrfCookie({ secure })]);
    json(res, 200, { ok: true });
  }

  async function dataExport(req, res) {
    const { user } = await requireSession(db, req);
    const prefs = await loadWrappedPrefs(db, user.id);
    res.setHeader('Content-Disposition', `attachment; filename="aniglobe-export-${user.username.toLowerCase()}.json"`);
    json(res, 200, {
      exportedAt: new Date().toISOString(),
      user: { ...publicUser(user), bio: user.bio || null, hasAvatar: Boolean(user.avatar_data) },
      wrappedPrefs: prefs ? prefs.payload : null,
      templates: await listTemplates(db, user.id),
      guessProgress: await listGuessProgress(db, user.id),
      activeSessionCount: await countActiveSessions(db, user.id),
    });
  }

  function ownProfile(user) {
    return {
      ...publicUser(user),
      bio: user.bio || null,
      avatar: user.avatar_data || null,
    };
  }

  async function getOwnProfile(req, res) {
    const { user } = await requireSession(db, req);
    json(res, 200, { profile: ownProfile(user) });
  }

  async function updateOwnProfile(req, res) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    const body = await readJsonBody(req);
    const bio = body.bio == null ? null : String(body.bio).trim();
    if (bio !== null && bio.length > BIO_MAX_CHARS) {
      throw new HttpError(400, 'Bios can be at most 280 characters.', { field: 'bio' });
    }
    let avatarData = user.avatar_data || null;
    if (body.avatar === null || body.avatar === undefined) {
      // explicit null clears the avatar; omitted means keep it — but the
      // client always sends `avatar` (data URL or null) so omitted == keep.
      if (body.avatar === null) avatarData = null;
    } else {
      avatarData = String(body.avatar);
      if (!AVATAR_MIME_PATTERN.test(avatarData)) {
        throw new HttpError(400, 'Avatar must be a JPEG, PNG, or WebP image.', { field: 'avatar' });
      }
      const base64 = avatarData.slice(avatarData.indexOf(',') + 1);
      if (Buffer.from(base64, 'base64').length > AVATAR_MAX_BYTES) {
        throw new HttpError(413, 'Avatar image is too large. Use an image under 150 KB after resizing.', { field: 'avatar' });
      }
    }
    await updateProfile(db, user.id, { bio: bio || null, avatarData });
    const next = await getUserById(db, user.id);
    json(res, 200, { profile: ownProfile(next) });
  }

  async function publicProfile(user) {
    const summary = await guessSummary(db, user.id);
    const total = summary.total;
    const progress = await listGuessProgress(db, user.id);
    const nowDate = new Date();
    const localMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    const todayIndex = Math.floor(localMidnight.getTime() / 86400000);
    const ownTemplates = await listTemplates(db, user.id);
    const gallery = ownTemplates
      .filter((t) => t.isPublic === true)
      .slice(0, 12)
      .map((t) => ({ name: t.name, theme: typeof t.payload?.theme === 'string' ? t.payload.theme : null, layout: t.payload?.layout === 'story' ? 'story' : 'square', updatedAt: t.updatedAt }));
    return {
      username: user.username,
      createdAt: user.created_at,
      verified: Boolean(user.email_verified_at),
      bio: user.bio || null,
      avatar: user.avatar_data || null,
      stats: {
        gamesPlayed: total,
        wins: summary.wins,
        winRate: total ? Math.round((summary.wins / total) * 100) : 0,
        currentStreak: currentStreak(progress, { todayIndex }),
        bestStreak: bestStreak(progress),
      },
      gallery,
    };
  }

  async function handlePublicProfile(req, res, username) {
    const user = await getUserByUsername(db, username);
    if (!user) throw new HttpError(404, 'That profile does not exist.');
    json(res, 200, { profile: await publicProfile(user) });
  }

  function shapePrefs(payload) {
    if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Preferences must be a JSON object.');
    if (Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024) throw new HttpError(413, 'Preferences are too large.');
    return payload;
  }

  async function wrappedPrefs(req, res) {
    const { user } = await requireSession(db, req);
    if (req.method === 'GET') {
      const saved = await loadWrappedPrefs(db, user.id);
      json(res, 200, { prefs: saved ? saved.payload : null, updatedAt: saved ? saved.updatedAt : null });
      return;
    }
    requireCsrf(req);
    const body = await readJsonBody(req);
    const prefs = shapePrefs(body.prefs);
    await saveWrappedPrefs(db, user.id, prefs);
    json(res, 200, { ok: true });
  }

  async function templates(req, res, parts) {
    const { user } = await requireSession(db, req);
    if (parts.length === 0) {
      if (req.method === 'GET') {
        json(res, 200, { templates: await listTemplates(db, user.id) });
        return;
      }
      requireCsrf(req);
      const body = await readJsonBody(req);
      const name = String(body.name == null ? '' : body.name).trim();
      if (!name || name.length > 64) throw new HttpError(400, 'Template names need 1–64 characters.', { field: 'name' });
      if (!body.payload || typeof body.payload !== 'object') throw new HttpError(400, 'Template payload must be a JSON object.');
      if (Buffer.byteLength(JSON.stringify(body.payload)) > 128 * 1024) throw new HttpError(413, 'Template is too large.');
      const existing = await listTemplates(db, user.id);
      const isNew = !existing.some((t) => t.name.toLowerCase() === name.toLowerCase());
      if (isNew && existing.length >= 50) {
        throw new HttpError(409, 'Template limit reached (50). Delete one to save another.', { field: 'name' });
      }
      await upsertTemplate(db, user.id, { name, payload: body.payload });
      json(res, 200, { ok: true, name });
      return;
    }
    if (parts.length === 1 && req.method === 'DELETE') {
      requireCsrf(req);
      await deleteTemplate(db, user.id, decodeURIComponent(parts[0]));
      json(res, 200, { ok: true });
      return;
    }
    if (parts.length === 1 && req.method === 'PUT') {
      requireCsrf(req);
      const body = await readJsonBody(req);
      const isPublic = body.isPublic === true;
      const name = decodeURIComponent(parts[0]);
      if (!(await setTemplatePublic(db, user.id, name, isPublic))) {
        throw new HttpError(404, 'That template does not exist.');
      }
      json(res, 200, { ok: true, name, isPublic });
      return;
    }
    throw new HttpError(404, 'Unknown endpoint.');
  }

  async function publicLibrary(req, res) {
    // No auth: the library is intentionally public. Only public templates
    // (explicit opt-in) are listed, with author + theme but no payload spam.
    // Viewer is optional so guests still load it; logged-in users get `loved`.
    const resolved = await resolveSession(db, req);
    const viewerId = resolved ? resolved.user.id : null;
    const url = new URL(req.url, 'http://placeholder');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    json(res, 200, { templates: await listPublicTemplates(db, { limit, offset, viewerId }) });
  }

  async function lovePublicTemplate(req, res, id) {
    const { user } = await requireSession(db, req);
    requireCsrf(req);
    const source = await getPublicTemplateById(db, Number(id));
    if (!source) throw new HttpError(404, 'That template does not exist.');
    const body = await readJsonBody(req);
    const loved = body.loved === true;
    await setTemplateLike(db, user.id, Number(id), loved);
    const listed = await listPublicTemplates(db, { limit: 50, viewerId: user.id });
    const current = listed.find((t) => String(t.id) === String(id));
    json(res, 200, { ok: true, loved, likes: current ? current.likes : null });
  }

  async function usePublicTemplate(req, res, id) {
    const { user } = await requireSession(db, req);
    requireCsrf(req);
    const source = await getPublicTemplateById(db, Number(id));
    if (!source || !source.payload) throw new HttpError(404, 'That template does not exist.');
    // Copy into the caller under a disambiguated name; never overwrite
    // silently — suffix with (n) until free (case-insensitive).
    let name = source.name;
    const existing = new Set((await listTemplates(db, user.id)).map((t) => t.name.toLowerCase()));
    if (existing.has(name.toLowerCase())) {
      let n = 2;
      while (existing.has((source.name + ' (' + n + ')').toLowerCase())) n += 1;
      name = source.name + ' (' + n + ')';
    }
    await upsertTemplate(db, user.id, { name, payload: source.payload });
    json(res, 200, { ok: true, name, payload: source.payload });
  }

  async function guess(req, res) {
    const { user } = await requireSession(db, req);
    if (req.method === 'GET') {
      const mediaType = new URL(req.url, 'http://placeholder').searchParams.get('media');
      if (mediaType && mediaType !== 'anime' && mediaType !== 'manga') {
        throw new HttpError(400, 'media must be "anime" or "manga".');
      }
      json(res, 200, { progress: await listGuessProgress(db, user.id, mediaType || null) });
      return;
    }
    requireCsrf(req);
    const body = await readJsonBody(req);
    if (body.mediaType !== 'anime' && body.mediaType !== 'manga') {
      throw new HttpError(400, 'mediaType must be "anime" or "manga".');
    }
    const mediaType = body.mediaType;
    if (!Number.isInteger(body.dayIndex) || body.dayIndex < 0) {
      throw new HttpError(400, 'dayIndex must be a non-negative integer.');
    }
    const score = Number.isInteger(body.score) ? body.score : 0;
    await saveGuessProgress(db, user.id, { mediaType, dayIndex: body.dayIndex, score, won: body.won === true });
    json(res, 200, { ok: true });
  }

  /* ------------------------------------------------------- catalogue + list */

  async function mediaSearch(req, res) {
    const url = new URL(req.url, 'http://placeholder');
    const query = String(url.searchParams.get('q') || '').trim();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 24));
    if (!query) {
      json(res, 200, { results: [], source: 'snapshot' });
      return;
    }
    const results = await searchSnapshot(db, query, { limit });
    json(res, 200, { results, source: 'snapshot' });
  }

  async function mediaDetail(req, res, id) {
    const media = await getSnapshotMedia(db, Number(id));
    if (!media) throw new HttpError(404, 'That title is not in the catalogue yet.');
    json(res, 200, { media });
  }

  async function libraryList(req, res) {
    const { user } = await requireSession(db, req);
    const entries = await listLibraryEntries(db, user.id);
    json(res, 200, { entries, stats: await libraryStats(db, user.id) });
  }

  async function libraryCreate(req, res) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    const body = await readJsonBody(req);
    const mediaId = Number(body.mediaId);
    if (!Number.isInteger(mediaId)) throw new HttpError(400, 'mediaId is required.');
    const media = await getMediaById(db, mediaId);
    if (!media) throw new HttpError(404, 'That title is not in the catalogue yet.');
    const status = normaliseStatus(body.status);
    const progress = normaliseProgress(body.progress);
    const score = normaliseScore(body.score);
    assertProgressWithinLimit(progress, media);
    const id = await upsertLibraryEntry(db, user.id, {
      mediaId,
      status,
      progress,
      score,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      favourite: body.favourite === true,
      rewatchCount: Number.isInteger(body.rewatchCount) && body.rewatchCount > 0 ? body.rewatchCount : 0,
      startedAt: body.startedAt || null,
      completedAt: body.completedAt || null,
      source: 'local',
    });
    json(res, 201, { entry: { id } });
  }

  async function libraryUpdate(req, res, id) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    const existing = await getLibraryEntry(db, user.id, Number(id));
    if (!existing) throw new HttpError(404, 'That entry does not exist.');
    const body = await readJsonBody(req);
    const media = await getMediaById(db, existing.media_id);
    const status = body.status === undefined ? existing.status : normaliseStatus(body.status);
    const progress = body.progress === undefined ? existing.progress : normaliseProgress(body.progress);
    const score = body.score === undefined ? existing.score : normaliseScore(body.score);
    if (media) assertProgressWithinLimit(progress, media);
    await upsertLibraryEntry(db, user.id, {
      mediaId: existing.media_id,
      status,
      progress,
      score,
      notes: body.notes === undefined ? existing.notes : (body.notes ? String(body.notes).slice(0, 2000) : null),
      favourite: body.favourite === undefined ? existing.favourite === 1 : body.favourite === true,
      rewatchCount: body.rewatchCount === undefined ? existing.rewatch_count : Number(body.rewatchCount) || 0,
      startedAt: body.startedAt === undefined ? existing.started_at : body.startedAt,
      completedAt: body.completedAt === undefined ? existing.completed_at : body.completedAt,
      source: existing.source,
    });
    json(res, 200, { ok: true });
  }

  async function libraryDelete(req, res, id) {
    requireCsrf(req);
    const { user } = await requireSession(db, req);
    const removed = await deleteLibraryEntry(db, user.id, Number(id));
    if (!removed) throw new HttpError(404, 'That entry does not exist.');
    json(res, 200, { ok: true });
  }

  async function libraryExport(req, res) {
    const { user } = await requireSession(db, req);
    const entries = await listLibraryEntries(db, user.id);
    const format = String(new URL(req.url, 'http://placeholder').searchParams.get('format') || 'json');
    if (format === 'csv') {
      const header = 'title,type,status,progress,total,score,favourite,notes';
      const lines = entries.map((entry) => [
        csvCell(entry.title),
        entry.chapters != null ? 'manga' : 'anime',
        entry.status,
        entry.progress,
        entry.chapters != null ? entry.chapters : entry.episodes,
        entry.score == null ? '' : entry.score,
        entry.favourite ? 'yes' : 'no',
        csvCell(entry.notes || ''),
      ].join(','));
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="aniglobe-library.csv"',
        'Cache-Control': 'no-store',
      });
      res.end([header].concat(lines).join('\n'));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="aniglobe-library.json"',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2));
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  async function catalogueSync(req, res) {
    // Guarded by a shared secret: the crawl must never be triggerable by a
    // random visitor, and it must not run on the request path for real users.
    const secret = cronSecret();
    const provided = String(req.headers['x-cron-secret'] || '');
    if (!secret || provided !== secret) {
      throw new HttpError(401, 'Not authorised.');
    }
    const url = new URL(req.url, 'http://placeholder');
    const mediaType = url.searchParams.get('mediaType') === 'manga' ? 'manga' : 'anime';
    const report = await runCatalogueSync(db, { mediaType });
    json(res, report.error ? 502 : 200, report);
  }

  async function catalogueStatus(req, res) {
    const provider = catalogueProviderId();
    const last = await getLastSyncRun(db, provider);
    json(res, 200, {
      provider,
      last: last
        ? {
            startedAt: last.started_at,
            finishedAt: last.finished_at,
            fetched: Number(last.fetched || 0),
            updated: Number(last.updated || 0),
            skipped: Number(last.skipped || 0),
            error: last.error || null,
          }
        : null,
    });
  }

  function normaliseStatus(value) {
    const status = String(value || 'PLANNING').toUpperCase();
    if (!LIBRARY_STATUSES.includes(status)) {
      throw new HttpError(400, 'Status must be one of: ' + LIBRARY_STATUSES.join(', ') + '.');
    }
    return status;
  }

  function normaliseProgress(value) {
    const progress = Number(value || 0);
    if (!Number.isInteger(progress) || progress < 0) {
      throw new HttpError(400, 'Progress must be a whole number of episodes or chapters.');
    }
    return progress;
  }

  function normaliseScore(value) {
    if (value === null || value === undefined || value === '') return null;
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      throw new HttpError(400, 'Score must be between 0 and 10.');
    }
    return Math.round(score * 10) / 10;
  }

  function assertProgressWithinLimit(progress, media) {
    const limit = media.chapters != null ? media.chapters : media.episodes;
    if (limit == null || progress <= limit) return;
    throw new HttpError(400, 'That is more than the ' + (media.chapters != null ? 'chapters' : 'episodes') + ' this title has.');
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
    ['/api/auth/oauth/providers', { GET: oauthProvidersRoute }],
    ['/api/auth/oauth/google/start', { GET: oauthStart }],
    ['/api/auth/oauth/google/callback', { GET: oauthCallback }],
    ['/api/auth/oauth/google', { DELETE: oauthUnlink }],
    ['/api/auth/sessions', { GET: listSessions }],
    ['/api/auth/sessions/revoke-all', { POST: revokeAllSessions }],
    ['/api/auth/export', { GET: dataExport }],
    ['/api/auth/profile', { GET: getOwnProfile, PUT: updateOwnProfile }],
    ['/api/media/search', { GET: mediaSearch }],
    ['/api/library', { GET: libraryList, POST: libraryCreate }],
    ['/api/library/export', { GET: libraryExport }],
    ['/api/catalogue/status', { GET: catalogueStatus }],
    ['/api/catalogue/sync', { POST: catalogueSync }],
    ['/api/sync/wrapped-prefs', { GET: wrappedPrefs, POST: wrappedPrefs }],
    ['/api/sync/guess', { GET: guess, POST: guess }],
  ]);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://placeholder');
    const pathname = url.pathname;

    // Parameterised paths are matched here (the routes map cannot express
    // them); order matters: the literal paths are checked first.
    if (pathname === '/api/media/search') {
      if (req.method !== 'GET') throw new HttpError(405, 'That method is not supported here.');
      await mediaSearch(req, res);
      return;
    }
    if (pathname.startsWith('/api/media/')) {
      const id = pathname.slice('/api/media/'.length);
      if (req.method !== 'GET') throw new HttpError(405, 'That method is not supported here.');
      await mediaDetail(req, res, id);
      return;
    }
    if (pathname.startsWith('/api/library/')) {
      const rest = pathname.slice('/api/library/'.length);
      if (rest === 'export') {
        if (req.method !== 'GET') throw new HttpError(405, 'That method is not supported here.');
        await libraryExport(req, res);
        return;
      }
      if (/^\d+$/u.test(rest)) {
        if (req.method === 'PUT') {
          await libraryUpdate(req, res, rest);
          return;
        }
        if (req.method === 'DELETE') {
          await libraryDelete(req, res, rest);
          return;
        }
        throw new HttpError(405, 'That method is not supported here.');
      }
    }

    if (pathname === '/api/templates/public' && req.method === 'GET') {
      await publicLibrary(req, res);
      return;
    }
    if (pathname.startsWith('/api/templates/public/') || pathname === '/api/templates/public/use') {
      const idPart = pathname.slice('/api/templates/public/'.length);
      const useMatch = idPart.match(/^(\d+)\/use$/u);
      if (req.method === 'POST' && useMatch) {
        await usePublicTemplate(req, res, useMatch[1]);
        return;
      }
      const loveMatch = idPart.match(/^(\d+)\/love$/u);
      if (req.method === 'POST' && loveMatch) {
        await lovePublicTemplate(req, res, loveMatch[1]);
        return;
      }
      throw new HttpError(404, 'Unknown endpoint.');
    }

    if (pathname === '/api/sync/templates' || pathname.startsWith('/api/sync/templates/')) {
      const rest = pathname.slice('/api/sync/templates'.length).split('/').filter(Boolean);
      await templates(req, res, rest);
      return;
    }

    if (pathname === '/api/auth/sessions/revoke-all' || pathname.startsWith('/api/auth/sessions/')) {
      const idPart = pathname.slice('/api/auth/sessions/'.length);
      const match = idPart.match(/^(\d+)$/);
      if (match && req.method === 'DELETE') {
        await revokeSession(req, res, match[1]);
        return;
      }
      if (pathname === '/api/auth/sessions/revoke-all' && req.method === 'POST') {
        await revokeAllSessions(req, res);
        return;
      }
      throw new HttpError(404, 'Unknown endpoint.');
    }

    if (pathname.startsWith('/api/profile/')) {
      if (req.method !== 'GET') throw new HttpError(405, 'That method is not supported here.');
      const username = decodeURIComponent(pathname.slice('/api/profile/'.length));
      if (!username || username.includes('/')) throw new HttpError(404, 'That profile does not exist.');
      await handlePublicProfile(req, res, username);
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
