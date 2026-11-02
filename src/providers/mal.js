/**
 * MyAnimeList data through the public Jikan-Edge API.
 */

import { runtime } from '../config.js';

const MIN_REQUEST_GAP = 400;
const REQUEST_TIMEOUT_MS = 10000;
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

export class MalError extends Error {
  constructor(message, code = 'unknown') {
    super(message);
    this.name = 'MalError';
    this.code = code;
  }
}

function isSafeUsername(username) {
  return /^[A-Za-z0-9_-]{2,16}$/.test(username);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function scheduleRequestStart() {
  const task = requestQueue.then(async () => {
    const remaining = MIN_REQUEST_GAP - (Date.now() - lastRequestAt);
    if (remaining > 0) await delay(remaining);
    lastRequestAt = Date.now();
  });

  requestQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

async function request(path) {
  await scheduleRequestStart();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  let payload;
  try {
    try {
      response = await fetch(runtime.jikanEndpoint + path, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (response.status === 404) {
        throw new MalError('That MyAnimeList profile or resource was not found.', 'not_found');
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        throw new MalError(
          retryAfter
            ? 'Jikan-Edge is rate-limiting requests. Try again in ' + retryAfter + ' seconds.'
            : 'Jikan-Edge is rate-limiting requests. Wait a moment and try again.',
          'rate_limited'
        );
      }
      if (response.status === 503) {
        throw new MalError('Jikan-Edge is temporarily unavailable. Try again shortly.', 'unavailable');
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof MalError) throw error;
      if (controller.signal.aborted || (error && error.name === 'AbortError')) {
        throw new MalError('Jikan-Edge did not respond within 10 seconds. Try again.', 'timeout');
      }
      if (response) {
        throw new MalError('Jikan-Edge returned data we could not read.', 'parse');
      }
      throw new MalError('Could not reach Jikan-Edge. Check your connection and try again.', 'network');
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (payload && payload.error) {
    const code = payload.error.code === 'RATE_LIMITED' ? 'rate_limited' :
      payload.error.code === 'NOT_FOUND' ? 'not_found' : 'api';
    throw new MalError(payload.error.message || 'Jikan-Edge could not complete the request.', code);
  }
  if (!response.ok) {
    throw new MalError('Jikan-Edge returned HTTP ' + response.status + '.', 'http');
  }
  return payload;
}

function toYear(date) {
  if (!date) return null;
  const year = new Date(date).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

export async function fetchProfile(username) {
  const name = String(username == null ? '' : username).trim();
  if (!name) throw new MalError('Enter a MyAnimeList username first.', 'empty_input');
  if (!isSafeUsername(name)) {
    throw new MalError('Enter the username from your MyAnimeList profile URL.', 'invalid_input');
  }

  const encodedName = encodeURIComponent(name);
  const profileResponse = await request('/users/' + encodedName + '/full');
  const profileData = profileResponse && profileResponse.data;
  const user = profileData && profileData.profile;
  if (!user || !user.username) {
    throw new MalError('MyAnimeList returned an incomplete user profile.', 'parse');
  }

  const stats = profileData.statistics && profileData.statistics.anime
    ? profileData.statistics.anime
    : {};
  const favorites = profileData.favorites && Array.isArray(profileData.favorites.anime)
    ? profileData.favorites.anime.map((entry) => ({
        id: entry.malId,
        title: entry.title || 'Untitled',
        average: null,
        genres: [],
      }))
    : [];
  const daysWatched = Number(stats.daysWatched);
  const hours = Number.isFinite(daysWatched) ? Math.round(daysWatched * 24) : null;
  const rawMeanScore = Number(stats.meanScore);
  const meanScoreRaw =
    Number.isFinite(rawMeanScore) && rawMeanScore > 0
      ? rawMeanScore
      : null;

  return {
    source: 'MyAnimeList',
    id: profileData.userId || null,
    name: user.username,
    url: user.profileUrl,
    memberSince: user.joinedAt ? new Date(user.joinedAt).getFullYear() : null,
    count: Number(stats.totalEntries) || 0,
    episodes: Number(stats.episodesWatched) || 0,
    minutes: Number.isFinite(hours) ? hours * 60 : null,
    hours,
    days: Number.isFinite(daysWatched) ? Math.round(daysWatched * 10) / 10 : null,
    meanScore: meanScoreRaw === null ? null : Math.round(meanScoreRaw * 10),
    meanScoreRaw,
    deviation: null,
    genres: [],
    formats: [],
    years: [],
    distribution: [],
    favourites: favorites,
    favoritesAvailable: true,
    favoritesError: null,
    scored: [],
    isSparse: !(Number(stats.totalEntries) > 0),
  };
}

function cleanHook(synopsis) {
  const text = String(synopsis || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  const end = text.search(/[.!?](?:\s|$)/);
  const sentence = end > 0 ? text.slice(0, end + 1) : text;
  return sentence.length > 180 ? sentence.slice(0, 177).trimEnd() + '...' : sentence;
}

function puzzleFromAnime(anime) {
  const answers = [
    anime.title,
    anime.titleEnglish,
    anime.titleJapanese,
    ...(anime.titleSynonyms || []),
  ].filter((title, index, all) =>
    typeof title === 'string' &&
    title.trim() &&
    all.findIndex((value) => value && value.trim().toLowerCase() === title.trim().toLowerCase()) === index
  );
  const studios = Array.isArray(anime.studios) ? anime.studios : [];
  const genres = Array.isArray(anime.genres) ? anime.genres : [];
  const year = Number(anime.year) || toYear(anime.aired && anime.aired.from);
  const hook = cleanHook(anime.synopsis);

  if (
    !year ||
    !studios.length ||
    !studios[0].name ||
    !anime.type ||
    !genres.length ||
    !genres[0].name ||
    !hook ||
    !answers.length
  ) {
    return null;
  }

  return {
    id: anime.malId,
    answers,
    year,
    studio: studios[0].name,
    format: anime.type,
    genres: genres.map((genre) => genre.name).filter(Boolean).slice(0, 4),
    hook,
  };
}

/**
 * Request one catalog page at a time; the UI never downloads the full catalog.
 */
export async function fetchAnimePage(page = 1) {
  if (!Number.isInteger(page) || page < 1) {
    throw new MalError('Catalog page must be a positive integer.', 'invalid_page');
  }

  const result = await request('/top/anime?page=' + page);
  const pagination = result && result.meta && result.meta.pagination;
  if (!result || !Array.isArray(result.data) || !pagination || !result.data.length) {
    throw new MalError('Jikan-Edge returned an incomplete anime catalog page.', 'parse');
  }
  return {
    items: result.data,
    page: pagination.page,
    hasNextPage: Boolean(pagination.hasNextPage),
  };
}

export async function fetchDailyPuzzle(date) {
  const day = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new MalError('A valid puzzle date is required.', 'invalid_date');
  }

  const firstPage = await fetchAnimePage(1);
  const seed = parseInt(day.split('-').join(''), 10);
  const offset = firstPage.items.reduce(
    (value, anime) => (value * 31 + anime.malId) % firstPage.items.length,
    seed % firstPage.items.length
  );
  const selected = firstPage.items[offset];
  if (!selected || !Number.isInteger(selected.malId)) {
    throw new MalError('Jikan-Edge did not return a valid anime for today’s puzzle.', 'parse');
  }
  const detail = await request('/anime/' + selected.malId + '/full');
  const puzzle = detail && detail.data ? puzzleFromAnime(detail.data) : null;

  if (!puzzle) {
    throw new MalError(
      'Jikan-Edge did not return an anime with enough public details for today’s clues. Try again later.',
      'no_puzzle'
    );
  }

  return puzzle;
}

export default {
  id: 'mal',
  label: 'MyAnimeList (via Jikan-Edge)',
  placeholder: 'MyAnimeList username',
  fetchProfile,
  isSafeUsername,
};
