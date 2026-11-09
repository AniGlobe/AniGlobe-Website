import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../api/_server/db.js';
import { createApiRouter } from '../api/_server/api.js';
import { sha256Hex } from '../api/_server/http.js';
import { hashPassword, verifyPassword } from '../api/_server/passwords.js';

/**
 * Start one ephemeral server per file with an in-memory database and return
 * a tiny client that mimics a browser: it keeps cookies and echoes the CSRF
 * value, which is exactly the surface a malicious client would fuzz.
 */
async function startTestServer({ mail = null, oauth = null } = {}) {
  const db = await openDatabase(':memory:');
  const outbox = [];
  const api = createApiRouter({
    db,
    registerLimiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
    loginLimiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
    resetLimiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
    mailer: mail || (async (message) => { outbox.push(message); }),
    ...(oauth ? { oauth } : {}),
  });
  const server = createServer(async (req, res) => {
    try {
      await api.handle(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: error.message || 'Server error',
          ...(error.details ? { details: error.details } : {}),
        }));
      } else {
        res.end();
      }
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    db,
    server,
    base: `http://127.0.0.1:${port}`,
    outbox,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function makeClient(base) {
  const cookies = new Map();
  const jar = () => [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  async function request(method, path, body = undefined) {
    const headers = {};
    if (cookies.size > 0) headers.cookie = jar();
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const csrf = cookies.get('aniglobe_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    for (const setCookie of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = setCookie.split(';')[0];
      const eq = pair.indexOf('=');
      cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const text = await res.text();
    let jsonBody = null;
    try {
      jsonBody = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    return { status: res.status, json: jsonBody, headers: res.headers };
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path, body) => request('DELETE', path, body),
    delNoCsrf: (path, body) => {
      const saved = cookies.get('aniglobe_csrf');
      cookies.delete('aniglobe_csrf');
      const pending = request('DELETE', path, body);
      if (saved) cookies.set('aniglobe_csrf', saved);
      return pending;
    },
    cookies,
    clearCookies: () => cookies.clear(),
  };
}

const GOOD_PASSWORD = 'Correct-Horse-42!';

test('register validation rejects weak input with field details', async () => {
  const { base, close } = await startTestServer();
  try {
    const client = makeClient(base);
    const res = await client.post('/api/auth/register', {
      username: 'ab',
      email: 'not-an-email',
      password: 'short',
    });
    assert.equal(res.status, 400);
    const fields = res.json.details.fields;
    assert.equal(fields.username.length > 0, true);
    assert.equal(fields.email.length > 0, true);
    assert.equal(fields.password.length > 0, true);
  } finally {
    await close();
  }
});

test('register - login - session - logout lifecycle', async () => {
  const { base, close } = await startTestServer();
  try {
    const client = makeClient(base);

    const registered = await client.post('/api/auth/register', {
      username: 'TestHero',
      email: 'hero@example.com',
      password: GOOD_PASSWORD,
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.json.user.username, 'TestHero');

    // Registration signs you in: the me endpoint sees the session cookie.
    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, 'hero@example.com');

    client.clearCookies();
    const anonymous = await client.get('/api/auth/me');
    assert.equal(anonymous.json.user, null);

    // Duplicate email/username conflict (case-insensitive).
    const stranger = makeClient(base);
    const dupEmail = await stranger.post('/api/auth/register', {
      username: 'someoneelse',
      email: 'HERO@example.com',
      password: GOOD_PASSWORD,
    });
    assert.equal(dupEmail.status, 409);
    assert.equal(dupEmail.json.details.field, 'email');

    // Wrong password is rejected; right one signs in.
    const wrong = await stranger.post('/api/auth/login', { identifier: 'TestHero', password: 'Wrong-Password-99!' });
    assert.equal(wrong.status, 401);
    const good = await stranger.post('/api/auth/login', { identifier: 'testhero', password: GOOD_PASSWORD });
    assert.equal(good.status, 200);
    assert.equal((await stranger.get('/api/auth/me')).json.user.username, 'TestHero');

    const out = await stranger.post('/api/auth/logout', {});
    assert.equal(out.status, 200);
    assert.equal((await stranger.get('/api/auth/me')).json.user, null);

    // Re-login by email also works.
    const byEmail = await stranger.post('/api/auth/login', { identifier: 'hero@example.com', password: GOOD_PASSWORD });
    assert.equal(byEmail.status, 200);
  } finally {
    await close();
  }
});

test('wrapped prefs and templates sync round-trips', async () => {
  const { base, close } = await startTestServer();
  try {
    const client = makeClient(base);
    const registered = await client.post('/api/auth/register', {
      username: 'Synced',
      email: 'sync@example.com',
      password: GOOD_PASSWORD,
    });
    assert.equal(registered.status, 201);

    const prefs = { theme: 'night', layout: 'story', colors: { bars: '#ff2d95' } };
    const saved = await client.post('/api/sync/wrapped-prefs', { prefs });
    assert.equal(saved.status, 200);

    const loaded = await client.get('/api/sync/wrapped-prefs');
    assert.deepEqual(loaded.json.prefs, prefs);

    const template = await client.post('/api/sync/templates', { name: 'Ember plum', payload: prefs });
    assert.equal(template.status, 200);
    const list = await client.get('/api/sync/templates');
    assert.deepEqual(list.json.templates.map((t) => t.name), ['Ember plum']);

    const removed = await client.del('/api/sync/templates/Ember%20plum');
    assert.equal(removed.status, 200);
    const empty = await client.get('/api/sync/templates');
    assert.deepEqual(empty.json.templates, []);

    // Mutations without the CSRF echo are rejected.
    const csrf = client.cookies.get('aniglobe_csrf');
    const noCsrf = await client.delNoCsrf('/api/sync/templates/nope');
    assert.equal(noCsrf.status, 403);
  } finally {
    await close();
  }
});

test('sync endpoints reject anonymous clients', async () => {
  const { base, close } = await startTestServer();
  try {
    const client = makeClient(base);
    const res = await client.get('/api/sync/wrapped-prefs');
    assert.equal(res.status, 401);
    const res2 = await client.post('/api/sync/wrapped-prefs', { prefs: {} });
    assert.equal(res2.status, 401);
  } finally {
    await close();
  }
});

test('guess progress syncs per media type and round-trips', async () => {
  const { base, close } = await startTestServer();
  try {
    const client = makeClient(base);
    const registered = await client.post('/api/auth/register', {
      username: 'Streaker',
      email: 'streaker@example.com',
      password: GOOD_PASSWORD,
    });
    assert.equal(registered.status, 201);

    const saved = await client.post('/api/sync/guess', {
      mediaType: 'anime',
      dayIndex: 20901,
      score: 440,
      won: true,
    });
    assert.equal(saved.status, 200);

    const all = await client.get('/api/sync/guess');
    assert.deepEqual(all.json.progress, [
      { mediaType: 'anime', dayIndex: 20901, score: 440, won: true },
    ]);

    const animeOnly = await client.get('/api/sync/guess?media=anime');
    assert.equal(animeOnly.json.progress.length, 1);
    const mangaOnly = await client.get('/api/sync/guess?media=manga');
    assert.deepEqual(mangaOnly.json.progress, []);
  } finally {
    await close();
  }
});

test('guess sync rejects anonymous clients and malformed entries', async () => {
  const { base, close } = await startTestServer();
  try {
    const anonymous = makeClient(base);
    assert.equal((await anonymous.post('/api/sync/guess', {
      mediaType: 'anime', dayIndex: 20901, score: 440, won: true,
    })).status, 401);
    assert.equal((await anonymous.get('/api/sync/guess')).status, 401);

    const client = makeClient(base);
    await client.post('/api/auth/register', {
      username: 'Prudish',
      email: 'prudish@example.com',
      password: GOOD_PASSWORD,
    });

    const badDay = await client.post('/api/sync/guess', {
      mediaType: 'anime', dayIndex: 'yesterday', score: 440, won: true,
    });
    assert.equal(badDay.status, 400);

    const badMedia = await client.post('/api/sync/guess', {
      mediaType: 'books', dayIndex: 20901, score: 440, won: true,
    });
    assert.equal(badMedia.status, 400, 'unknown media is rejected rather than silently stored as anime');

    const after = await client.get('/api/sync/guess?media=anime');
    assert.equal(after.json.progress.length, 0, 'rejected entry did not land as anime');
  } finally {
    await close();
  }
});

test('password change requires the current password and re-issues the session', async () => {
  const { base, close } = await startTestServer();
  try {
    const client = makeClient(base);
    await client.post('/api/auth/register', {
      username: 'Changer',
      email: 'change@example.com',
      password: GOOD_PASSWORD,
    });

    const wrongCurrent = await client.post('/api/auth/password', {
      currentPassword: 'Not-The-Password-1!',
      newPassword: 'New-Password-99!',
    });
    assert.equal(wrongCurrent.status, 403);

    const ok = await client.post('/api/auth/password', {
      currentPassword: GOOD_PASSWORD,
      newPassword: 'Brand-New-Password-1!',
    });
    assert.equal(ok.status, 200);
    assert.equal((await client.get('/api/auth/me')).json.user.username, 'Changer');

    // Old password no longer works; the new one does.
    const other = makeClient(base);
    assert.equal((await other.post('/api/auth/login', { identifier: 'Changer', password: GOOD_PASSWORD })).status, 401);
    assert.equal((await other.post('/api/auth/login', { identifier: 'Changer', password: 'Brand-New-Password-1!' })).status, 200);
  } finally {
    await close();
  }
});

test('sessions: list, revoke one of two, revoke everywhere', async () => {
  const { base, close } = await startTestServer();
  try {
    const phone = makeClient(base);
    const tab = makeClient(base);
    await phone.post('/api/auth/register', {
      username: 'TwoDevice',
      email: 'twodevice@example.com',
      password: GOOD_PASSWORD,
    });
    await tab.post('/api/auth/login', { identifier: 'TwoDevice', password: GOOD_PASSWORD });

    const listed = await phone.get('/api/auth/sessions');
    assert.equal(listed.status, 200);
    assert.equal(listed.json.sessions.length, 2);
    assert.equal(listed.json.sessions.filter((s) => s.current).length, 1);

    const otherId = listed.json.sessions.find((s) => !s.current).id;
    const revoked = await phone.del('/api/auth/sessions/' + otherId);
    assert.equal(revoked.status, 200);
    assert.equal((await phone.get('/api/auth/sessions')).json.sessions.length, 1);

    // The other device is now signed out.
    assert.equal((await tab.get('/api/auth/me')).json.user, null);

    // Unknown session id 404s; another user's session cannot be revoked.
    const notFound = await phone.del('/api/auth/sessions/999999');
    assert.equal(notFound.status, 404);

    const nuked = await phone.post('/api/auth/sessions/revoke-all', {});
    assert.equal(nuked.status, 200);
    assert.equal((await phone.get('/api/auth/me')).json.user, null);
  } finally {
    await close();
  }
});

test('password reset: request never reveals whether the email exists', async () => {
  const { base, outbox, close } = await startTestServer();
  try {
    const client = makeClient(base);
    await client.post('/api/auth/register', {
      username: 'Resettable',
      email: 'resettable@example.com',
      password: GOOD_PASSWORD,
    });
    client.clearCookies();

    // Existing email gets mail; unknown email answers identically with no mail.
    const existing = await client.post('/api/auth/password-reset/request', { email: 'resettable@example.com' });
    assert.equal(existing.status, 200);
    assert.equal(existing.json.ok, true);
    const resetMail = outbox.find((m) => m.subject.startsWith('Reset your'));
    assert.ok(resetMail, 'a reset email was queued');
    assert.equal(resetMail.to, 'resettable@example.com');

    const resetCount = outbox.filter((m) => m.subject.startsWith('Reset your')).length;
    const missing = await client.post('/api/auth/password-reset/request', { email: 'ghost@example.com' });
    assert.equal(missing.status, 200);
    assert.equal(missing.json.ok, true);
    assert.equal(outbox.filter((m) => m.subject.startsWith('Reset your')).length, resetCount, 'no mail for unknown email');

    const match = resetMail.text.match(/token=([^&\s]+)/);
    assert.ok(match, 'reset link carries the token');
    const stranger = makeClient(base);
    const confirmed = await stranger.post('/api/auth/password-reset/confirm', {
      token: decodeURIComponent(match[1]),
      newPassword: 'Reset-Password-77!',
    });
    assert.equal(confirmed.status, 200);

    // Old password rejected, new one works.
    assert.equal((await stranger.post('/api/auth/login', { identifier: 'Resettable', password: GOOD_PASSWORD })).status, 401);
    assert.equal((await stranger.post('/api/auth/login', { identifier: 'Resettable', password: 'Reset-Password-77!' })).status, 200);

    // Reusing the token fails.
    assert.equal((await stranger.post('/api/auth/password-reset/confirm', {
      token: decodeURIComponent(match[1]),
      newPassword: 'Another-Password-1!',
    })).status, 400);
  } finally {
    await close();
  }
});

test('email verification: register sends a link, confirm marks verified', async () => {
  const { base, outbox, close } = await startTestServer();
  try {
    const client = makeClient(base);
    const registered = await client.post('/api/auth/register', {
      username: 'Verifiable',
      email: 'verifiable@example.com',
      password: GOOD_PASSWORD,
    });
    assert.equal(registered.json.user.verified, false);
    const verifyMail = outbox.find((m) => m.subject.startsWith('Confirm your email'));
    assert.ok(verifyMail, 'a verification email was queued');
    assert.equal(verifyMail.to, 'verifiable@example.com');

    const tokenMatch = verifyMail.text.match(/token=([^&\s]+)/);
    assert.ok(tokenMatch);
    const confirmed = await client.post('/api/auth/verify/confirm', {
      token: decodeURIComponent(tokenMatch[1]),
    });
    assert.equal(confirmed.status, 200);
    assert.equal((await client.get('/api/auth/me')).json.user.verified, true);

    // Resend is a no-op for already-verified users (200 either way).
    const resend = await client.post('/api/auth/verify/resend', {});
    assert.equal(resend.status, 200);
  } finally {
    await close();
  }
});

test('data export bundles the account record and synced data', async () => {
  const { base, close } = await startTestServer();
  try {
    const client = makeClient(base);
    await client.post('/api/auth/register', {
      username: 'Exporter',
      email: 'exporter@example.com',
      password: GOOD_PASSWORD,
    });
    await client.post('/api/sync/wrapped-prefs', { prefs: { theme: 'ember' } });
    await client.post('/api/sync/templates', { name: 'Ember plum', payload: { theme: 'ember' } });
    await client.post('/api/sync/guess', { mediaType: 'anime', dayIndex: 20901, score: 440, won: true });

    const exported = await client.get('/api/auth/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.json.user.username, 'Exporter');
    assert.equal(exported.json.wrappedPrefs.theme, 'ember');
    assert.deepEqual(exported.json.templates.map((t) => t.name), ['Ember plum']);
    assert.equal(exported.json.guessProgress.length, 1);
    assert.equal(exported.json.activeSessionCount, 1);

    const anonymous = makeClient(base);
    assert.equal((await anonymous.get('/api/auth/export')).status, 401);
  } finally {
    await close();
  }
});

test('public template library: private stays hidden until published, use copies', async () => {
  const { base, close } = await startTestServer();
  try {
    const owner = makeClient(base);
    await owner.post('/api/auth/register', { username: 'Owner', email: 'owner@example.com', password: GOOD_PASSWORD });
    await owner.post('/api/sync/templates', { name: 'Night plum', payload: { theme: 'night', layout: 'story' } });

    const anon = makeClient(base);
    assert.deepEqual((await anon.get('/api/templates/public')).json.templates, [], 'private templates are not listed');

    const pub = await owner.put('/api/sync/templates/Night%20plum', { isPublic: true });
    assert.equal(pub.status, 200);
    assert.equal(pub.json.isPublic, true);

    const listed = await anon.get('/api/templates/public');
    assert.equal(listed.json.templates.length, 1);
    assert.equal(listed.json.templates[0].name, 'Night plum');
    assert.equal(listed.json.templates[0].author, 'Owner');
    assert.equal(listed.json.templates[0].theme, 'night');
    assert.equal('payload' in listed.json.templates[0], false, 'listing omits full payload');

    const id = listed.json.templates[0].id;
    assert.equal((await anon.post(`/api/templates/public/${id}/use`, {})).status, 401, 'anon cannot fork');

    const fork = await owner.post(`/api/templates/public/${id}/use`, {});
    assert.equal(fork.status, 200);
    assert.equal(fork.json.name.startsWith('Night plum'), true);
    const own = await owner.get('/api/sync/templates');
    assert.equal(own.json.templates.some((t) => t.name === fork.json.name), true);

    const love = await owner.post(`/api/templates/public/${id}/love`, { loved: true });
    assert.equal(love.status, 200);
    assert.equal(love.json.loved, true);
    const afterLove = await anon.get('/api/templates/public');
    assert.equal(afterLove.json.templates[0].likes, 1);
    const unlike = await owner.post(`/api/templates/public/${id}/love`, { loved: false });
    assert.equal(unlike.json.loved, false);
    assert.equal(unlike.json.likes, 0);

    const unpub = await owner.put('/api/sync/templates/Night%20plum', { isPublic: false });
    assert.equal(unpub.json.isPublic, false);
    assert.deepEqual((await anon.get('/api/templates/public')).json.templates, []);
    assert.equal((await owner.put('/api/sync/templates/missing', { isPublic: true })).status, 404);
  } finally {
    await close();
  }
});

test('google oauth: mocked PKCE login, tampered state, unlink guard', async () => {
  const fake = {
    authorizationUrl: async ({ state, codeChallenge }) => 'https://accounts.google.com/auth?state=' + encodeURIComponent(state) + '&code_challenge=' + encodeURIComponent(codeChallenge),
    exchange: async ({ code }) => {
      if (code !== 'good-code') throw new Error('bad code');
      return { sub: 'google-sub-1', email: 'gin@example.com', email_verified: true, name: 'Gin' };
    },
  };
  const { base, close } = await startTestServer({ oauth: fake });
  try {
    const providers = await makeClient(base).get('/api/auth/oauth/providers');
    assert.equal(providers.status, 200);
    assert.equal(providers.json.providers[0].enabled, true);

    const client = makeClient(base);
    const start = await client.get('/api/auth/oauth/google/start');
    assert.equal(start.status, 302);
    const authUrl = start.headers.get('location');
    assert.ok(authUrl.includes('state='));
    const state = new URL(authUrl).searchParams.get('state');
    const callback = await client.get('/api/auth/oauth/google/callback?code=good-code&state=' + encodeURIComponent(state));
    assert.equal(callback.status, 302);
    assert.ok((callback.headers.get('location') || '').includes('#/account?oauth=ok'));
    const me = await client.get('/api/auth/me');
    assert.equal(me.json.user.email, 'gin@example.com');
    assert.equal(me.json.user.oauthProvider, 'google');
    assert.equal(me.json.user.verified, true);

    // Replayed state/code must fail.
    const replay = await makeClient(base).get('/api/auth/oauth/google/callback?code=good-code&state=' + encodeURIComponent(state));
    assert.equal(replay.status, 302);
    assert.ok((replay.headers.get('location') || '').includes('oauth=error'));

    // Unlink without password is refused.
    const noPw = await client.del('/api/auth/oauth/google', {});
    assert.equal(noPw.status, 403);
  } finally {
    await close();
  }
  const off = await startTestServer();
  try {
    assert.equal((await makeClient(off.base).get('/api/auth/oauth/google/start')).status, 501);
  } finally {
    await off.close();
  }
});

test('profile: own bio/avatar save, public read never leaks email', async () => {
  const { base, close } = await startTestServer();
  try {
    const client = makeClient(base);
    await client.post('/api/auth/register', {
      username: 'Prof',
      email: 'prof@example.com',
      password: GOOD_PASSWORD,
    });
    await client.post('/api/sync/guess', { mediaType: 'anime', dayIndex: 20901, score: 500, won: true });

    const avatar = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0x01]).toString('base64');
    const saved = await client.put('/api/auth/profile', { bio: 'hello there', avatar });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.profile.bio, 'hello there');
    assert.equal(saved.json.profile.avatar, avatar);

    const own = await client.get('/api/auth/profile');
    assert.equal(own.status, 200);
    assert.equal(own.json.profile.email, 'prof@example.com');

    const pub = await makeClient(base).get('/api/profile/Prof');
    assert.equal(pub.status, 200);
    assert.equal(pub.json.profile.username, 'Prof');
    assert.equal(pub.json.profile.bio, 'hello there');
    assert.equal(pub.json.profile.avatar, avatar);
    assert.equal(pub.json.profile.stats.gamesPlayed, 1);
    assert.equal(pub.json.profile.stats.wins, 1);
    assert.equal('email' in pub.json.profile, false, 'public profile must not leak email');

    assert.equal((await makeClient(base).get('/api/profile/nobody')).status, 404);
    assert.equal((await makeClient(base).get('/api/auth/profile')).status, 401);

    const tooLong = await client.put('/api/auth/profile', { bio: 'x'.repeat(281), avatar: undefined });
    assert.equal(tooLong.status, 400);
    const badMime = await client.put('/api/auth/profile', { bio: null, avatar: 'data:text/plain;base64,AAAA' });
    assert.equal(badMime.status, 400);

    const cleared = await client.put('/api/auth/profile', { bio: null, avatar: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.profile.avatar, null);
  } finally {
    await close();
  }
});

test('deleting the account ends the session and removes the user', async () => {
  const { base, db, close } = await startTestServer();
  try {
    const client = makeClient(base);
    await client.post('/api/auth/register', {
      username: 'Doomed',
      email: 'doomed@example.com',
      password: GOOD_PASSWORD,
    });

    const wrong = await client.del('/api/auth/account', { password: 'Nope-Nope-Nope-1!' });
    assert.equal(wrong.status, 403);

    const gone = await client.del('/api/auth/account', { password: GOOD_PASSWORD });
    assert.equal(gone.status, 200);
    assert.equal((await client.get('/api/auth/me')).json.user, null);

    const relogin = await client.post('/api/auth/login', { identifier: 'Doomed', password: GOOD_PASSWORD });
    assert.equal(relogin.status, 401);
    const countRow = (await db.execute('SELECT COUNT(*) AS n FROM users')).rows[0];
    assert.equal(countRow.n, 0);
  } finally {
    await close();
  }
});

test('password hashing is salted, self-describing, and constant-time verified', () => {
  const a = hashPassword('some-password-123');
  const b = hashPassword('some-password-123');
  assert.notEqual(a, b, 'each hash must carry a fresh salt');
  assert.equal(verifyPassword('some-password-123', a), true);
  assert.equal(verifyPassword('some-password-123', b), true);
  assert.equal(verifyPassword('not-the-password', a), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.equal(/^[0-9a-f]{64}$/.test(sha256Hex('token')), true);
});
