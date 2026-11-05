/**
 * MyAnimeList data through the public Jikan-Edge API.
 */

import { runtime } from '../config.js';
import { resolveMediaType } from '../domain/media.js';

const MIN_REQUEST_GAP = 400;
const REQUEST_TIMEOUT_MS = 10000;
const USER_LIST_PAGE_LIMIT = 300;
const MAX_USER_LIST_PAGES = 100;
const MAX_TITLE_DETAILS = 16;
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

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStatus(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s_-]/g, '');
  const statuses = {
    watching: 'watching',
    reading: 'reading',
    completed: 'completed',
    onhold: 'onHold',
    dropped: 'dropped',
    plantowatch: 'planToWatch',
    plantoread: 'planToRead',
  };
  return statuses[key] || key || 'unknown';
}

function normalizeListEntry(entry) {
  const score = finiteNumber(entry && entry.score);
  return {
    id: entry && entry.malId,
    title: entry && typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : 'Untitled',
    status: normalizeStatus(entry && entry.status),
    score: score !== null && score > 0 ? score : null,
    progress: finiteNumber(entry && entry.progress),
    total: finiteNumber(entry && entry.total),
    startedAt: entry && entry.startedAt || null,
    finishedAt: entry && entry.finishedAt || null,
    updatedAt: entry && entry.updatedAt || null,
  };
}

export function normalizeListEntries(entries) {
  return entries.map(normalizeListEntry);
}

export function deriveListMetrics(entries) {
  const statusCounts = {};
  const scoreCounts = new Map();
  for (const entry of entries) {
    statusCounts[entry.status] = (statusCounts[entry.status] || 0) + 1;
    if (entry.score !== null) {
      scoreCounts.set(entry.score, (scoreCounts.get(entry.score) || 0) + 1);
    }
  }

  const scored = entries
    .filter((entry) => entry.status === 'completed' && entry.score !== null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  return {
    statusCounts,
    distribution: Array.from(scoreCounts, ([score, count]) => ({ score, count }))
      .sort((a, b) => a.score - b.score),
    scored,
  };
}

async function fetchUserList(username, mediaType, onProgress) {
  const entries = [];
  let page = 1;
  let expectedTotal = null;

  while (page <= MAX_USER_LIST_PAGES) {
    onProgress('Fetching ' + mediaType + ' list page ' + page + '...');
    const response = await request(
      '/users/' + username + '/' + mediaType + 'list?page=' + page + '&limit=' + USER_LIST_PAGE_LIMIT
    );
    if (!Array.isArray(response && response.data)) {
      throw new MalError('MyAnimeList returned an incomplete ' + mediaType + ' list.', 'parse');
    }

    entries.push(...normalizeListEntries(response.data));
    const pagination = response.meta && response.meta.pagination;
    const total = finiteNumber(pagination && pagination.total);
    if (total !== null) expectedTotal = total;

    const loaded = entries.length;
    onProgress(
      'Loaded ' + loaded.toLocaleString() +
      (expectedTotal === null ? ' ' + mediaType + ' titles.' : ' of ' + expectedTotal.toLocaleString() + ' ' + mediaType + ' titles.')
    );

    if (!pagination || pagination.hasNextPage !== true) {
      if (expectedTotal !== null && loaded < expectedTotal) {
        throw new MalError(
          'MyAnimeList returned ' + loaded.toLocaleString() + ' of ' + expectedTotal.toLocaleString() +
            ' ' + mediaType + ' titles. Try again later.',
          'incomplete_data'
        );
      }
      return entries;
    }

    page += 1;
  }

  throw new MalError('MyAnimeList list pagination exceeded the supported page limit.', 'incomplete_data');
}

function metadataSample(entries) {
  const unique = new Map();
  const ordered = [
    ...entries.filter((entry) => entry.status === 'completed' && entry.score !== null)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)),
    ...entries.filter((entry) => entry.status === 'completed'),
    ...entries,
  ];

  for (const entry of ordered) {
    if (entry.id != null && !unique.has(entry.id)) unique.set(entry.id, entry);
    if (unique.size >= MAX_TITLE_DETAILS) break;
  }
  return Array.from(unique.values());
}

function aggregateTitleDetails(sample, detailsById) {
  const genres = new Map();
  const formats = new Map();
  const years = new Map();

  for (const entry of sample) {
    const details = detailsById.get(entry.id);
    if (!details) continue;

    for (const genre of Array.isArray(details.genres) ? details.genres : []) {
      if (!genre || !genre.name) continue;
      const current = genres.get(genre.name) || { name: genre.name, count: 0, scoreTotal: 0, scoredCount: 0 };
      current.count += 1;
      if (entry.score !== null) {
        current.scoreTotal += entry.score * 10;
        current.scoredCount += 1;
      }
      genres.set(genre.name, current);
    }

    if (details.type) formats.set(details.type, (formats.get(details.type) || 0) + 1);
    const year = finiteNumber(details.year) || toYear(details.aired && details.aired.from);
    if (year) years.set(year, (years.get(year) || 0) + 1);
  }

  return {
    genres: Array.from(genres.values())
      .map((genre) => ({
        name: genre.name,
        count: genre.count,
        meanScore: genre.scoredCount ? Math.round(genre.scoreTotal / genre.scoredCount) : null,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    formats: Array.from(formats, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    years: Array.from(years, ([year, count]) => ({ year, count }))
      .sort((a, b) => b.count - a.count || b.year - a.year),
  };
}

async function fetchTitleDetails(sample, mediaType, onProgress) {
  const detailsById = new Map();
  let warning = '';

  for (let index = 0; index < sample.length; index += 1) {
    const entry = sample[index];
    onProgress('Checking title details ' + (index + 1) + ' of ' + sample.length + '...');
    try {
      const response = await request('/' + mediaType + '/' + encodeURIComponent(entry.id) + '/full');
      const details = response && response.data;
      if (!details) throw new MalError('MyAnimeList returned incomplete title details.', 'parse');
      detailsById.set(entry.id, details);
    } catch (error) {
      if (!(error instanceof MalError)) throw error;
      if (error.code === 'not_found') continue;
      warning = 'Some MyAnimeList title details could not be loaded: ' + error.message;
      break;
    }
  }

  return { detailsById, warning };
}

export async function fetchProfile(username, mediaType = 'anime', onProgress = () => {}) {
  const media = resolveMediaType(mediaType);
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

  const entries = await fetchUserList(encodedName, media.id, onProgress);
  const listMetrics = deriveListMetrics(entries);
  const sample = metadataSample(entries);
  const titleDetailResult = await fetchTitleDetails(sample, media.id, onProgress);
  const titleDetails = aggregateTitleDetails(sample, titleDetailResult.detailsById);

  const stats = profileData.statistics && profileData.statistics[media.id]
    ? profileData.statistics[media.id]
    : {};
  const favorites = profileData.favorites && Array.isArray(profileData.favorites[media.id])
    ? profileData.favorites[media.id].map((entry) => ({
        id: entry.malId,
        title: entry.title || 'Untitled',
        average: null,
        genres: [],
      }))
    : [];
  const validDays = finiteNumber(media.id === 'anime' ? stats.daysWatched : stats.daysRead);
  const hours = media.id === 'anime' && validDays !== null ? Math.round(validDays * 24) : null;
  const rawMeanScore = finiteNumber(stats.meanScore);
  const meanScoreRaw =
    Number.isFinite(rawMeanScore) && rawMeanScore > 0
      ? rawMeanScore
      : null;
  const summaryCount = finiteNumber(stats.totalEntries);
  const dataWarnings = [];
  if (summaryCount !== null && summaryCount !== entries.length) {
    dataWarnings.push(
      'MyAnimeList reports ' + summaryCount.toLocaleString() + ' titles, while its list returned ' +
        entries.length.toLocaleString() + '. List sections use the returned entries.'
    );
  }
  if (titleDetailResult.warning) dataWarnings.push(titleDetailResult.warning);

  return {
    source: 'MyAnimeList',
    mediaType: media.id,
    id: profileData.userId || null,
    name: user.username,
    url: user.profileUrl,
    memberSince: user.joinedAt ? new Date(user.joinedAt).getFullYear() : null,
    count: entries.length,
    episodes: media.id === 'anime' ? Number(stats.episodesWatched) || 0 : null,
    chapters: media.id === 'manga' ? Number(stats.chaptersRead) || 0 : null,
    volumes: media.id === 'manga' ? Number(stats.volumesRead) || 0 : null,
    minutes: hours === null ? null : hours * 60,
    hours,
    days: validDays === null ? null : Math.round(validDays * 10) / 10,
    daysRead: media.id === 'manga' && validDays !== null ? Math.round(validDays * 10) / 10 : null,
    meanScore: meanScoreRaw === null ? null : Math.round(meanScoreRaw * 10),
    meanScoreRaw,
    deviation: null,
    genres: titleDetails.genres,
    genreSampleSize: titleDetailResult.detailsById.size,
    genrePopulationSize: entries.length,
    genresSampled: titleDetailResult.detailsById.size < entries.length,
    formats: titleDetails.formats,
    years: titleDetails.years,
    distribution: listMetrics.distribution,
    statusCounts: listMetrics.statusCounts,
    listEntries: entries,
    favourites: favorites,
    favoritesAvailable: true,
    favoritesError: null,
    scored: listMetrics.scored.map((entry) => {
      const details = titleDetailResult.detailsById.get(entry.id);
      const average = finiteNumber(details && details.score);
      return {
        id: entry.id,
        title: entry.title,
        score: entry.score,
        average: average !== null && average > 0 ? Math.round(average * 10) : null,
        genres: details && Array.isArray(details.genres)
          ? details.genres.map((genre) => genre.name).filter(Boolean)
          : [],
      };
    }),
    dataWarning: dataWarnings.join(' '),
    isSparse: entries.length < 10,
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
  const genreNames = genres.map((genre) => genre.name).filter(Boolean).join(', ');
  const year = Number(anime.year) || toYear(anime.aired && anime.aired.from);
  const hook = cleanHook(anime.synopsis);
  const clues = [
    year && { label: 'Year', value: String(year) },
    studios[0] && studios[0].name && { label: 'Studio', value: studios[0].name },
    anime.type && { label: 'Format', value: anime.type },
    genreNames && { label: 'Genres', value: genreNames },
    hook && { label: 'Story', value: hook },
    Number(anime.episodes) > 0 && { label: 'Episodes', value: String(anime.episodes) },
    anime.source && { label: 'Source', value: anime.source },
    anime.rating && { label: 'Age rating', value: anime.rating },
    anime.status && { label: 'Release status', value: anime.status },
  ].filter(Boolean);

  if (clues.length < 5 || !answers.length) return null;

  return {
    id: anime.malId,
    mediaType: 'anime',
    answers,
    clues,
  };
}

function puzzleFromManga(manga) {
  const answers = [
    manga.title,
    manga.titleEnglish,
    manga.titleJapanese,
    ...(manga.titleSynonyms || []),
  ].filter((title, index, all) =>
    typeof title === 'string' &&
    title.trim() &&
    all.findIndex((value) => value && value.trim().toLowerCase() === title.trim().toLowerCase()) === index
  );
  const authors = Array.isArray(manga.authors) ? manga.authors : [];
  const serializations = Array.isArray(manga.serializations) ? manga.serializations : [];
  const genres = Array.isArray(manga.genres) ? manga.genres : [];
  const genreNames = genres.map((genre) => genre.name).filter(Boolean).join(', ');
  const year = Number(manga.year) || toYear(manga.published && manga.published.from);
  const hook = cleanHook(manga.synopsis);

  const chapters = Number(manga.chapters);
  const volumes = Number(manga.volumes);
  const clues = [
    year && { label: 'Year', value: String(year) },
    authors[0] && authors[0].name && { label: 'Author', value: authors[0].name },
    serializations[0] && serializations[0].name && { label: 'Magazine', value: serializations[0].name },
    genreNames && { label: 'Genres', value: genreNames },
    hook && { label: 'Story', value: hook },
    manga.type && { label: 'Format', value: manga.type },
    Number.isFinite(chapters) && chapters > 0 && { label: 'Chapters', value: String(chapters) },
    Number.isFinite(volumes) && volumes > 0 && { label: 'Volumes', value: String(volumes) },
    manga.status && { label: 'Publication status', value: manga.status },
  ].filter(Boolean);

  if (clues.length < 5 || !answers.length) return null;

  return {
    id: manga.malId,
    mediaType: 'manga',
    answers,
    clues,
  };
}

/**
 * Request one catalog page at a time; the UI never downloads the full catalog.
 */
export async function fetchAnimePage(page = 1, mediaType = 'anime') {
  const media = resolveMediaType(mediaType);
  if (!Number.isInteger(page) || page < 1) {
    throw new MalError('Catalog page must be a positive integer.', 'invalid_page');
  }

  const result = await request('/top/' + media.id + '?page=' + page);
  const pagination = result && result.meta && result.meta.pagination;
  if (!result || !Array.isArray(result.data) || !pagination || !result.data.length) {
    throw new MalError('Jikan-Edge returned an incomplete ' + media.label.toLowerCase() + ' catalog page.', 'parse');
  }
  return {
    items: result.data,
    page: pagination.page,
    hasNextPage: Boolean(pagination.hasNextPage),
  };
}

export async function fetchDailyPuzzle(date, mediaType = 'anime') {
  const media = resolveMediaType(mediaType);
  const day = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new MalError('A valid puzzle date is required.', 'invalid_date');
  }

  const firstPage = await fetchAnimePage(1, media.id);
  const seed = parseInt(day.split('-').join(''), 10);
  const offset = firstPage.items.reduce(
    (value, anime) => (value * 31 + anime.malId) % firstPage.items.length,
    seed % firstPage.items.length
  );
  let puzzle = null;
  for (let attempt = 0; attempt < Math.min(5, firstPage.items.length); attempt += 1) {
    const selected = firstPage.items[(offset + attempt) % firstPage.items.length];
    if (!selected || !Number.isInteger(selected.malId)) continue;
    const detail = await request('/' + media.id + '/' + selected.malId + '/full');
    const record = detail && detail.data;
    puzzle = record
      ? media.id === 'manga' ? puzzleFromManga(record) : puzzleFromAnime(record)
      : null;
    if (puzzle) break;
  }

  if (!puzzle) {
    throw new MalError(
      'Jikan-Edge did not return a ' + media.label.toLowerCase() + ' with enough public details for today’s clues. Try again later.',
      'no_puzzle'
    );
  }

  return puzzle;
}

export default {
  id: 'mal',
  label: 'MyAnimeList (via Jikan-Edge)',
  shortLabel: 'MyAnimeList',
  placeholder: 'MyAnimeList username',
  fetchProfile,
  isSafeUsername,
};
