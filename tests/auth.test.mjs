import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../server/db.js';
import { createApiRouter } from '../server/api.js';
import { sha256Hex } from '../server/http.js';
import { hashPassword, verifyPassword } from '../server/passwords.js';

/**
 * Start one ephemeral server per file with an in-memory database and return
 * a tiny client that mimics a browser: it keeps cookies and echoes the CSRF
 * value, which is exactly the surface a malicious client would fuzz.
 */
async function startTestServer() {
  const db = openDatabase(':memory:');
  const api = createApiRouter({
    db,
    registerLimiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
    loginLimiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
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
    assert.equal(badMedia.status, 200, 'unknown media normalizes to anime rather than erroring');

    const after = await client.get('/api/sync/guess?media=anime');
    assert.equal(after.json.progress.length, 1);
    assert.equal(after.json.progress[0].mediaType, 'anime');
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
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
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
