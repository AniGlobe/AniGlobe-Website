import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase, upsertMedia, tokeniseTitle, normaliseTitle } from '../api/_server/db.js';
import { createApiRouter } from '../api/_server/api.js';
import { searchSnapshot, shapeMedia } from '../api/_server/catalogue-store.js';

const GOOD_PASSWORD = 'Correct-Horse-42!';

async function startTestServer({ mail = null } = {}) {
  const db = await openDatabase(':memory:');
  const outbox = [];
  const api = createApiRouter({
    db,
    registerLimiter: { consume: async () => ({ allowed: true, retryAfterMs: 0 }) },
    loginLimiter: { consume: async () => ({ allowed: true, retryAfterMs: 0 }) },
    resetLimiter: { consume: async () => ({ allowed: true, retryAfterMs: 0 }) },
    mailer: mail || (async (message) => { outbox.push(message); }),
  });
  const server = createServer(async (req, res) => {
    try {
      await api.handle(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message || 'Server error' }));
      } else {
        res.end();
      }
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    db,
    outbox,
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
    if (body !== undefined) headers['content-type'] = 'application/json';
    const csrf = cookies.get('aniglobe_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const setCookie of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const pair = setCookie.split(';')[0];
      const eq = pair.indexOf('=');
      cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, headers: res.headers, text };
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path, body) => request('DELETE', path, body),
    cookies,
  };
}

function seedMedia(db, overrides = {}) {
  const media = {
    provider: 'kitsu',
    providerId: String(overrides.providerId || 1),
    titleEn: overrides.titleEn || 'Cowboy Bebop',
    titleRomaji: overrides.titleRomaji || 'Cowboy Bebop',
    titleNative: null,
    titleNorm: normaliseTitle(overrides.titleEn || 'Cowboy Bebop'),
    format: 'TV',
    subtype: 'TV',
    episodes: overrides.episodes === undefined ? 26 : overrides.episodes,
    chapters: overrides.chapters === undefined ? null : overrides.chapters,
    volumes: null,
    status: 'FINISHED',
    season: 'SPRING',
    seasonYear: overrides.year || 1998,
    averageRating: 8.75,
    popularity: 500000,
    genres: JSON.stringify(['Action', 'Space']),
    coverUrl: 'https://media.kitsu.io/cover.jpg',
    synopsis: 'A bounty hunter crew.',
    nsfw: false,
    updatedAt: null,
    expiresAt: null,
  };
  return upsertMedia(db, media, tokeniseTitle(media.titleEn));
}

test('catalogue snapshot stores media and finds it by token and prefix', async () => {
  const { db, close } = await startTestServer();
  try {
    const id = await seedMedia(db);
    assert.ok(id > 0);

    const byToken = await searchSnapshot(db, 'cowboy');
    assert.equal(byToken.length, 1);
    assert.equal(byToken[0].title, 'Cowboy Bebop');
    assert.equal(byToken[0].episodes, 26);
    assert.deepEqual(byToken[0].genres, ['Action', 'Space']);

    const byPrefix = await searchSnapshot(db, 'cowboy bebop');
    assert.equal(byPrefix.length, 1);

    const miss = await searchSnapshot(db, 'zzzznotathing');
    assert.deepEqual(miss, []);
  } finally {
    await close();
  }
});

test('catalogue search endpoint serves the snapshot without a provider call', async () => {
  const server = await startTestServer();
  try {
    const { db, base, close } = server;
    await seedMedia(db);
    const client = makeClient(base);
    const search = await client.get('/api/media/search?q=cowboy');
    assert.equal(search.status, 200);
    assert.equal(search.json.results.length, 1);
    assert.equal(search.json.results[0].title, 'Cowboy Bebop');
    assert.equal(search.json.source, 'snapshot');

    const empty = await client.get('/api/media/search?q=');
    assert.deepEqual(empty.json.results, []);
  } finally {
    await server.close();
  }
});

test('library entries: create, validate, update, list, delete', async () => {
  const server = await startTestServer();
  try {
    const { db, base, close } = server;
    const mediaId = await seedMedia(db);
    const client = makeClient(base);

    await client.post('/api/auth/register', {
      username: 'Tracker',
      email: 'tracker@example.com',
      password: GOOD_PASSWORD,
    });

    const created = await client.post('/api/library', { mediaId, status: 'CURRENT', progress: 3, score: 8 });
    assert.equal(created.status, 201);

    const list = await client.get('/api/library');
    assert.equal(list.status, 200);
    assert.equal(list.json.entries.length, 1);
    assert.equal(list.json.entries[0].status, 'CURRENT');
    assert.equal(list.json.entries[0].progress, 3);
    assert.equal(list.json.stats.byStatus.CURRENT, 1);

    const badProgress = await client.post('/api/library', { mediaId: mediaId + 999, progress: 5 });
    assert.equal(badProgress.status, 404);

    const badStatus = await client.post('/api/library', { mediaId, status: 'NOPE' });
    assert.equal(badStatus.status, 400);

    const tooFar = await client.post('/api/library', { mediaId, progress: 999 });
    assert.equal(tooFar.status, 400);

    const badScore = await client.post('/api/library', { mediaId, score: 42 });
    assert.equal(badScore.status, 400);

    const entryId = list.json.entries[0].id;
    const updated = await client.put('/api/library/' + entryId, { status: 'COMPLETED', progress: 26, score: 9 });
    assert.equal(updated.status, 200);
    const after = await client.get('/api/library');
    assert.equal(after.json.entries[0].status, 'COMPLETED');
    assert.equal(after.json.entries[0].progress, 26);
    assert.equal(after.json.stats.completed, 1);

    const removed = await client.del('/api/library/' + entryId);
    assert.equal(removed.status, 200);
    const empty = await client.get('/api/library');
    assert.equal(empty.json.entries.length, 0);
  } finally {
    await server.close();
  }
});

test('library requires a session and export returns the list', async () => {
  const server = await startTestServer();
  try {
    const { db, base, close } = server;
    const mediaId = await seedMedia(db);
    const anon = makeClient(base);
    assert.equal((await anon.get('/api/library')).status, 401);
    // Mutating routes check CSRF before the session (same order as every
    // other mutating route in this API), so an anonymous write is a 403.
    assert.equal((await anon.post('/api/library', { mediaId })).status, 403);

    const client = makeClient(base);
    await client.post('/api/auth/register', {
      username: 'Exporter',
      email: 'exporter@example.com',
      password: GOOD_PASSWORD,
    });
    await client.post('/api/library', { mediaId, status: 'COMPLETED', progress: 26, score: 10, favourite: true });

    const exported = await client.get('/api/library/export?format=json');
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition') || '', /attachment/);
    assert.ok(exported.text.includes('Cowboy Bebop'));

    const csv = await client.get('/api/library/export?format=csv');
    assert.equal(csv.status, 200);
    assert.ok(csv.text.includes('title,type,status'));
    assert.ok(csv.text.includes('Cowboy Bebop'));
  } finally {
    await server.close();
  }
});

test('catalogue sync trigger requires the cron secret', async () => {
  const server = await startTestServer();
  try {
    const { base, close } = server;
    const client = makeClient(base);
    assert.equal((await client.post('/api/catalogue/sync')).status, 401);
  } finally {
    await server.close();
  }
});

test('media detail endpoint returns the snapshot row and 404s for unknown ids', async () => {
  const server = await startTestServer();
  try {
    const { db, base, close } = server;
    const mediaId = await seedMedia(db);
    const client = makeClient(base);
    const detail = await client.get('/api/media/' + mediaId);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.media.title, 'Cowboy Bebop');
    assert.equal((await client.get('/api/media/999999')).status, 404);
  } finally {
    await server.close();
  }
});

test('shapeMedia parses genres defensively', () => {
  assert.deepEqual(shapeMedia({ genres: 'not json' }).genres, []);
  assert.deepEqual(shapeMedia({ genres: '["Action"]' }).genres, ['Action']);
});
