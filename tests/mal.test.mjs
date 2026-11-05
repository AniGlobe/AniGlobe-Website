import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveListMetrics, fetchProfile, normalizeListEntries } from '../src/providers/mal.js';

test('normalizes MyAnimeList list statuses and derives score and completion metrics', () => {
  const entries = normalizeListEntries([
    { malId: 1, title: '  Finished  ', status: 'Completed', score: 9 },
    { malId: 2, title: 'In progress', status: 'Watching', score: 0 },
    { malId: 3, title: 'Queued', status: 'Plan to Watch', score: null },
  ]);
  const metrics = deriveListMetrics(entries);

  assert.equal(entries[0].title, 'Finished');
  assert.equal(entries[1].score, null);
  assert.deepEqual(metrics.statusCounts, { completed: 1, watching: 1, planToWatch: 1 });
  assert.deepEqual(metrics.distribution, [{ score: 9, count: 1 }]);
  assert.deepEqual(metrics.scored.map((entry) => entry.title), ['Finished']);
});

test('fetches all list pages and returns MAL Wrapped sections', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let clock = 100000;
  const requests = [];
  Date.now = () => {
    clock += 1000;
    return clock;
  };
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url.pathname + url.search);

    if (url.pathname.endsWith('/users/reader/full')) {
      return response({
        data: {
          profile: { username: 'reader', profileUrl: 'https://myanimelist.net/profile/reader', joinedAt: '2020-01-01' },
          userId: 77,
          statistics: { anime: { totalEntries: 19, episodesWatched: 68, daysWatched: 2.5, meanScore: 8.2 } },
          favorites: { anime: [] },
        },
      });
    }

    if (url.pathname.endsWith('/users/reader/animelist')) {
      const page = Number(url.searchParams.get('page'));
      return response({
        data: page === 1
          ? [
              { malId: 1, title: 'Top title', status: 'Completed', score: 9, progress: 12, total: 12 },
              { malId: 2, title: 'Watching title', status: 'Watching', score: 0, progress: 4, total: 12 },
              ...Array.from({ length: 16 }, (_, index) => ({
                malId: index + 3,
                title: 'Completed ' + (index + 3),
                status: 'Completed',
                score: 5,
                progress: 12,
                total: 12,
              })),
            ]
          : [{ malId: 19, title: 'Second completed', status: 'Completed', score: 8, progress: 24, total: 24 }],
        meta: { pagination: { total: 19, hasNextPage: page === 1 } },
      });
    }

    const detailMatch = url.pathname.match(/\/anime\/(\d+)\/full$/);
    if (detailMatch) {
      return response({
        data: {
          score: 8.5,
          type: 'TV',
          year: 2020,
          genres: [{ name: 'Drama' }, { name: 'Adventure' }],
        },
      });
    }

    throw new Error('Unexpected mocked request: ' + url.pathname);
  };

  try {
    const profile = await fetchProfile('reader', 'anime');
    assert.equal(profile.count, 19);
    assert.equal(profile.hours, 60);
    assert.deepEqual(profile.statusCounts, { completed: 18, watching: 1 });
    assert.deepEqual(profile.distribution, [
      { score: 5, count: 16 },
      { score: 8, count: 1 },
      { score: 9, count: 1 },
    ]);
    assert.deepEqual(profile.scored.slice(0, 2).map((entry) => entry.title), ['Top title', 'Second completed']);
    assert.equal(profile.genres[0].name, 'Adventure');
    assert.deepEqual(profile.formats, [{ name: 'TV', count: 16 }]);
    assert.deepEqual(profile.years, [{ year: 2020, count: 16 }]);
    assert.equal(profile.genreSampleSize, 16);
    assert.equal(profile.genresSampled, true);
    assert.equal(profile.dataWarning, '');
    assert.equal(requests.filter((path) => path.includes('/animelist?')).length, 2);
    assert.equal(requests.filter((path) => /\/anime\/\d+\/full$/.test(path)).length, 16);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

function response(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => payload,
  };
}
