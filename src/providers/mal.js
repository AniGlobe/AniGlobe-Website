/**
 * MyAnimeList data through Jikan's public, unofficial REST API.
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
        throw new MalError('Jikan is rate-limiting requests. Wait a minute and try again.', 'rate_limited');
      }
      if (response.status === 503) {
        throw new MalError('Jikan is temporarily unavailable. Try again shortly.', 'unavailable');
      }
      if (!response.ok) {
        throw new MalError('Jikan returned HTTP ' + response.status + '.', 'http');
      }

      payload = await response.json();
    } catch (error) {
      if (error instanceof MalError) throw error;
      if (controller.signal.aborted || (error && error.name === 'AbortError')) {
        throw new MalError('Jikan did not respond within 10 seconds. Try again.', 'timeout');
      }
      if (response) {
        throw new MalError('Jikan returned data we could not read.', 'parse');
      }
      throw new MalError('Could not reach Jikan. Check your connection and try again.', 'network');
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (payload && payload.error) {
    throw new MalError(String(payload.error), 'api');
  }
  return payload;
}

function titleOf(anime) {
  return anime.title_english || anime.title || anime.title_japanese || 'Untitled';
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
  const [profileResponse, favoritesResult] = await Promise.all([
    request('/users/' + encodedName + '/full'),
    request('/users/' + encodedName + '/favorites').then(
      (response) => ({ response }),
      (error) => ({ error })
    ),
  ]);
  const user = profileResponse && profileResponse.data;
  if (!user || !user.username) {
    throw new MalError('MyAnimeList returned an incomplete user profile.', 'parse');
  }

  const stats = user.statistics && user.statistics.anime ? user.statistics.anime : {};
  let favorites = [];
  let favoritesAvailable = true;
  let favoritesError = null;
  if (favoritesResult.error) {
    favoritesAvailable = false;
    if (!(favoritesResult.error instanceof MalError && favoritesResult.error.code === 'not_found')) {
      favoritesError = favoritesResult.error.message;
    }
  } else {
    const anime = favoritesResult.response &&
      favoritesResult.response.data &&
      favoritesResult.response.data.anime;
    favorites = Array.isArray(anime)
      ? anime.map((entry) => ({
          id: entry.mal_id,
          title: titleOf(entry),
          average: null,
          genres: [],
        }))
      : [];
  }

  const daysWatched = Number(stats.days_watched);
  const hours = Number.isFinite(daysWatched) ? Math.round(daysWatched * 24) : null;
  const rawMeanScore = Number(stats.mean_score);
  const meanScoreRaw =
    Number.isFinite(rawMeanScore) && rawMeanScore > 0
      ? rawMeanScore
      : null;

  return {
    source: 'MyAnimeList',
    id: user.mal_id,
    name: user.username,
    url: user.url,
    memberSince: toYear(user.joined),
    count: Number(stats.total_entries) || 0,
    episodes: Number(stats.episodes_watched) || 0,
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
    favoritesAvailable,
    favoritesError,
    scored: [],
    isSparse: !(Number(stats.total_entries) > 0),
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
  const titles = Array.isArray(anime.titles) ? anime.titles.map((entry) => entry.title) : [];
  const answers = [
    anime.title,
    anime.title_english,
    anime.title_japanese,
    ...(anime.title_synonyms || []),
    ...titles,
  ].filter((title, index, all) =>
    typeof title === 'string' &&
    title.trim() &&
    all.findIndex((value) => value && value.trim().toLowerCase() === title.trim().toLowerCase()) === index
  );
  const studios = Array.isArray(anime.studios) ? anime.studios : [];
  const genres = Array.isArray(anime.genres) ? anime.genres : [];
  const year =
    Number(anime.year) ||
    toYear(anime.aired && anime.aired.from);
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
    id: anime.mal_id,
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
export async function fetchAnimePage(page = 1, limit = 25) {
  if (!Number.isInteger(page) || page < 1) {
    throw new MalError('Catalog page must be a positive integer.', 'invalid_page');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new MalError('Catalog page size must be between 1 and 25.', 'invalid_limit');
  }

  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sfw: 'true',
    order_by: 'members',
    sort: 'desc',
  });
  const result = await request('/anime?' + query.toString());
  if (!result || !Array.isArray(result.data) || !result.pagination) {
    throw new MalError('Jikan returned an incomplete anime catalog page.', 'parse');
  }
  return {
    items: result.data,
    page: result.pagination.current_page,
    lastPage: result.pagination.last_visible_page,
    hasNextPage: Boolean(result.pagination.has_next_page),
  };
}

export async function fetchDailyPuzzle(date) {
  const day = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new MalError('A valid puzzle date is required.', 'invalid_date');
  }

  const firstPage = await fetchAnimePage(1);
  if (!Number.isInteger(firstPage.lastPage) || firstPage.lastPage < 1) {
    throw new MalError('Jikan returned an invalid catalog page count.', 'parse');
  }

  const seed = parseInt(day.split('-').join(''), 10);
  const startPage = seed % firstPage.lastPage;
  let puzzle = null;

  for (let attempt = 0; attempt < Math.min(5, firstPage.lastPage); attempt += 1) {
    const page = ((startPage + attempt) % firstPage.lastPage) + 1;
    const pageData = page === 1 ? firstPage : await fetchAnimePage(page);
    const offset = seed % Math.max(pageData.items.length, 1);
    const ordered = pageData.items.slice(offset).concat(pageData.items.slice(0, offset));
    puzzle = ordered.map(puzzleFromAnime).find(Boolean) || null;
    if (puzzle) break;
  }

  if (!puzzle) {
    throw new MalError(
      'Jikan did not return an anime with enough public details for today’s clues. Try again later.',
      'no_puzzle'
    );
  }

  return puzzle;
}

export default {
  id: 'mal',
  label: 'MyAnimeList (via Jikan)',
  placeholder: 'MyAnimeList username',
  fetchProfile,
  isSafeUsername,
};
