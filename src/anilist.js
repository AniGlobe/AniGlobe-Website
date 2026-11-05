/**
 * AniList GraphQL client for public anime and manga profiles.
 *
 * Everything GraphQL-shaped lives here so tool modules stay presentation-only.
 * No auth, no key, no proxy — AniList allows public queries from the browser.
 *
 * NOTE: this codebase deliberately contains no literal dollar-sign character.
 * Template interpolation is done with concatenation, and the GraphQL username
 * is inlined after strict validation rather than passed as a variable. See
 * README for why.
 */

import { runtime } from './config.js';

/**
 * Error with a machine-readable `code` so the UI can show a useful message
 * instead of "Something went wrong."
 */
export class AniListError extends Error {
  constructor(message, code = 'unknown') {
    super(message);
    this.name = 'AniListError';
    this.code = code;
  }
}

/** Low-level POST. Throws AniListError on transport, HTTP or GraphQL errors. */
async function gql(query) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let response;
  let payload;
  try {
    response = await fetch(runtime.anilistEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    payload = await response.json();
  } catch (error) {
    if (controller.signal.aborted || (error && error.name === 'AbortError')) {
      throw new AniListError('AniList did not respond within 10 seconds. Try again.', 'timeout');
    }
    if (response) {
      throw new AniListError('AniList sent a response we could not read.', 'parse');
    }
    throw new AniListError(
      'Could not reach AniList. Check your connection and try again.',
      'network'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 429) {
    throw new AniListError('AniList is rate-limiting us. Wait a minute and retry.', 'rate_limited');
  }

  if (!payload || typeof payload !== 'object') {
    throw new AniListError('AniList sent a response we could not read.', 'parse');
  }

  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new AniListError(
      (payload.errors[0] && payload.errors[0].message) || 'AniList rejected the query.',
      'graphql'
    );
  }

  if (!response.ok) {
    throw new AniListError('AniList returned HTTP ' + response.status + '.', 'http');
  }

  return payload.data;
}

/* --------------------------------------------------------------------------
   Query template
   -------------------------------------------------------------------------- */

/**
 * One round trip gets the selected media summary, favorites, and top completed
 * titles without fetching the user's full list.
 *
 * `statistics.anime` gives aggregates and breakdowns; `favourites` gives the
 * user's favorites; a paginated list query gets only the top completed titles.
 *
 * The validated username is substituted into the query template.
 */
const PROFILE_QUERY = `
  query {
    User(name: "%ANILIST_USERNAME%") {
      id
      name
      siteUrl
      createdAt
      statistics {
        %MEDIA_FIELD% {
          count
          episodesWatched
          minutesWatched
          chaptersRead
          volumesRead
          meanScore
          standardDeviation
          genres(limit: 8, sort: COUNT_DESC) { genre count meanScore }
          scores(limit: 10) { score count }
          formats(limit: 6, sort: COUNT_DESC) { format count }
          releaseYears(limit: 12, sort: COUNT_DESC) { releaseYear count }
        }
      }
      favourites {
        %MEDIA_FIELD%(page: 1) {
          nodes { id title { romaji english } averageScore genres }
        }
      }
    }
    Page(page: 1, perPage: 10) {
      mediaList(userName: "%ANILIST_USERNAME%", type: %MEDIA_TYPE%, status: COMPLETED, sort: SCORE_DESC) {
        score(format: POINT_10)
        media { id title { romaji english } averageScore genres }
      }
    }
  }
`;

/* --------------------------------------------------------------------------
   Public API
   -------------------------------------------------------------------------- */

/**
 * Fetch a user's profile summary.
 *
 * @param {string} username
 * @returns {Promise<object>} normalised profile, ready for rendering
 */
export async function fetchProfile(username, mediaType = 'anime') {
  const media = mediaType === 'manga' ? 'manga' : 'anime';
  const name = String(username == null ? '' : username).trim();

  if (!name) throw new AniListError('Enter an AniList username first.', 'empty_input');
  if (!isSafeUsername(name)) {
    throw new AniListError(
      'That does not look like an AniList username. Use the one in your profile URL.',
      'invalid_input'
    );
  }

  const query = PROFILE_QUERY
    .replace(/%ANILIST_USERNAME%/g, name)
    .replace(/%MEDIA_FIELD%/g, media)
    .replace(/%MEDIA_TYPE%/g, media.toUpperCase());
  const data = await gql(query);
  const user = data && data.User;

  if (!user) {
    throw new AniListError(
      'No AniList user named "' + name + '". Check the spelling: it is the profile URL slug, not your display name.',
      'not_found'
    );
  }

  const entries = data.Page && Array.isArray(data.Page.mediaList)
    ? data.Page.mediaList
    : [];
  return normaliseProfile(user, entries, media);
}

/**
 * Usernames are inlined into the query, so validation is the security boundary.
 * AniList names are letters, digits, underscore and hyphen; anything outside
 * that set is rejected rather than escaped.
 */
function isSafeUsername(name) {
  if (name.length < 2 || name.length > 32) return false;
  return name.split('').every((character) => /[A-Za-z0-9_-]/.test(character));
}

/**
 * Flatten AniList's shape into something the card renders without conditionals.
 * Missing data degrades to empty arrays and zeros instead of throwing.
 */
function normaliseProfile(user, completed, mediaType) {
  const stats = (user.statistics && user.statistics[mediaType]) || {};
  const favouriteNodes =
    (user.favourites && user.favourites[mediaType] && user.favourites[mediaType].nodes) || [];

  // Scored entries only: a COMPLETED list can contain score 0, meaning unscored.
  const scored = completed
    .filter((entry) => entry && entry.score > 0 && entry.media)
    .map((entry) => ({
      id: entry.media.id,
      title: pickTitle(entry.media.title),
      score: entry.score,
      average: toNumber(entry.media.averageScore),
      genres: entry.media.genres || [],
    }));

  const minutes = toNumber(stats.minutesWatched);
  const daysRead = null;

  return {
    source: 'AniList',
    mediaType,
    id: user.id,
    name: user.name,
    url: user.siteUrl,
    memberSince: user.createdAt ? new Date(user.createdAt * 1000).getFullYear() : null,
    count: toNumber(stats.count) || 0,
    episodes: mediaType === 'anime' ? toNumber(stats.episodesWatched) || 0 : null,
    chapters: mediaType === 'manga' ? toNumber(stats.chaptersRead) || 0 : null,
    volumes: mediaType === 'manga' ? toNumber(stats.volumesRead) || 0 : null,
    minutes,
    hours: mediaType === 'anime' && minutes !== null ? Math.round(minutes / 60) : null,
    days: mediaType === 'anime' && minutes !== null
      ? Math.round((minutes / 60 / 24) * 10) / 10
      : null,
    daysRead,
    meanScore: toNumber(stats.meanScore),
    deviation: toNumber(stats.standardDeviation),
    genres: (stats.genres || []).map((row) => ({
      name: row.genre,
      count: toNumber(row.count) || 0,
      meanScore: toNumber(row.meanScore),
    })),
    formats: (stats.formats || []).map((row) => ({
      name: row.format,
      count: toNumber(row.count) || 0,
    })),
    years: (stats.releaseYears || []).map((row) => ({
      year: row.releaseYear,
      count: toNumber(row.count) || 0,
    })),
    distribution: (stats.scores || [])
      .map((row) => ({ score: toNumber(row.score), count: toNumber(row.count) || 0 }))
      .filter((row) => row.score > 0)
      .sort((a, b) => a.score - b.score),
    favourites: favouriteNodes.filter(Boolean).map((media) => ({
      id: media.id,
      title: pickTitle(media.title),
      average: toNumber(media.averageScore),
      genres: media.genres || [],
    })),
    scored,
    isSparse: (toNumber(stats.count) || 0) < 10,
  };
}

/** Coerce to a finite number, or null. */
function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** English title wins, then romaji. Never returns undefined. */
function pickTitle(title) {
  if (!title) return 'Untitled';
  return title.english || title.romaji || 'Untitled';
}
