/**
 * AniList GraphQL client.
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
  let response;
  try {
    response = await fetch(runtime.anilistEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query }),
    });
  } catch {
    throw new AniListError(
      'Could not reach AniList. Check your connection and try again.',
      'network'
    );
  }

  if (response.status === 429) {
    throw new AniListError('AniList is rate-limiting us. Wait a minute and retry.', 'rate_limited');
  }

  if (!response.ok) {
    throw new AniListError('AniList returned HTTP ' + response.status + '.', 'http');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AniListError('AniList sent a response we could not read.', 'parse');
  }

  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new AniListError(
      (payload.errors[0] && payload.errors[0].message) || 'AniList rejected the query.',
      'graphql'
    );
  }

  return payload.data;
}

/* --------------------------------------------------------------------------
   Query template
   -------------------------------------------------------------------------- */

/**
 * One round trip, everything the card needs.
 *
 * `statistics.anime` gives aggregates (count, minutes watched, mean score)
 * plus per-genre/tag breakdowns; `favourites` gives the user's top titles;
 * `mediaListCollection` gives scored entries for the taste signals.
 *
 * The username is substituted into NAME_PLACEHOLDER rather than passed as a
 * GraphQL variable, which keeps the request body free of dollar signs.
 */
const NAME_PLACEHOLDER = '%ANILIST_USERNAME%';

const PROFILE_QUERY = `
  query {
    User(name: "%ANILIST_USERNAME%") {
      id
      name
      siteUrl
      createdAt
      statistics {
        anime {
          count
          episodesWatched
          minutesWatched
          meanScore
          standardDeviation
          genres(limit: 8, sort: COUNT_DESC) { genre count meanScore }
          scores(limit: 10) { score count }
          formats(limit: 6, sort: COUNT_DESC) { format count }
          releaseYears(limit: 12, sort: COUNT_DESC) { releaseYear count }
        }
      }
      favourites {
        anime(limit: 10) {
          nodes { id title { romaji english } averageScore genres }
        }
      }
      mediaListCollection(type: ANIME, status: COMPLETED, sort: SCORE_DESC) {
        lists {
          entries {
            score(format: POINT_10)
            media { id title { romaji english } averageScore genres }
          }
        }
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
export async function fetchProfile(username) {
  const name = String(username == null ? '' : username).trim();

  if (!name) throw new AniListError('Enter an AniList username first.', 'empty_input');
  if (!isSafeUsername(name)) {
    throw new AniListError(
      'That does not look like an AniList username. Use the one in your profile URL.',
      'invalid_input'
    );
  }

  const data = await gql(PROFILE_QUERY.replace(NAME_PLACEHOLDER, name));
  const user = data && data.User;

  if (!user) {
    throw new AniListError(
      'No AniList user named "' + name + '". Check the spelling: it is the profile URL slug, not your display name.',
      'not_found'
    );
  }

  return normaliseProfile(user);
}

/**
 * Usernames are inlined into the query, so validation is the security boundary.
 * AniList names are letters, digits, underscore and hyphen; anything outside
 * that set is rejected rather than escaped.
 */
function isSafeUsername(name) {
  if (name.length < 2 || name.length > 32) return false;
  return /^[A-Za-z0-9_-]+\x24/.test(name);
}

/**
 * Flatten AniList's shape into something the card renders without conditionals.
 * Missing data degrades to empty arrays and zeros instead of throwing.
 */
function normaliseProfile(user) {
  const stats = (user.statistics && user.statistics.anime) || {};
  const lists = (user.mediaListCollection && user.mediaListCollection.lists) || [];
  const completed = (lists[0] && lists[0].entries) || [];
  const favouriteNodes =
    (user.favourites && user.favourites.anime && user.favourites.anime.nodes) || [];

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

  const minutes = toNumber(stats.minutesWatched) || 0;

  return {
    id: user.id,
    name: user.name,
    url: user.siteUrl,
    memberSince: user.createdAt ? new Date(user.createdAt * 1000).getFullYear() : null,
    count: toNumber(stats.count) || 0,
    episodes: toNumber(stats.episodesWatched) || 0,
    minutes,
    hours: Math.round(minutes / 60),
    days: Math.round((minutes / 60 / 24) * 10) / 10,
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

/* --------------------------------------------------------------------------
   Derived taste signals
   Pure functions over the normalised profile. They depend on AniList's
   vocabulary, not on the UI, so they live here rather than in the tool.
   -------------------------------------------------------------------------- */

/**
 * Score a profile against taste archetypes and return the strongest match.
 * Deterministic: the same profile always gets the same label, which matters
 * because people screenshot and compare these.
 *
 * Order is significant. Earlier entries are more specific, so they win ties.
 */
const ARCHETYPES = [
  {
    label: 'The Completionist',
    blurb: 'You finish what you start. Every season, every OVA, every movie.',
    test: (p) => p.count >= 200 && p.distribution.length >= 7,
  },
  {
    label: 'The Genre Loyalist',
    blurb: 'One genre owns your list, and you are not sorry about it.',
    test: (p) => p.genres.length > 0 && p.genres[0].count > p.count * 0.35,
  },
  {
    label: 'The Binger',
    blurb: 'Episode count dwarfs title count. You go deep, not wide.',
    test: (p) => p.count > 0 && p.episodes / p.count > 26,
  },
  {
    label: 'The Critic',
    blurb: 'Your mean score sits below average. Nothing gets a free pass.',
    test: (p) => p.meanScore !== null && p.meanScore < 68,
  },
  {
    label: 'The Enthusiast',
    blurb: 'Your mean score sits high. You watch to enjoy, not to grade.',
    test: (p) => p.meanScore !== null && p.meanScore > 78,
  },
  {
    label: 'The Contrarian',
    blurb: 'You rate things differently from the crowd, on purpose.',
    test: (p) =>
      p.meanScore !== null &&
      Math.abs(p.meanScore - 72) > 6 &&
      p.deviation !== null &&
      p.deviation > 14,
  },
  {
    label: 'The Curator',
    blurb: 'A tight list, deliberately kept. Quality over quantity.',
    test: (p) => p.count > 0 && p.count < 60,
  },
];

const DEFAULT_ARCHETYPE = {
  label: 'The Explorer',
  blurb: 'A bit of everything. Your list has range.',
};

/** @returns {{label: string, blurb: string}} */
export function tasteProfile(profile) {
  const match = ARCHETYPES.find((archetype) => {
    try {
      return archetype.test(profile);
    } catch {
      return false;
    }
  });
  return match ? { label: match.label, blurb: match.blurb } : DEFAULT_ARCHETYPE;
}

/**
 * The single most "you" title: the one you scored furthest above the site
 * average. Returns null when there is not enough overlap to be meaningful.
 */
export function signatureTitle(profile) {
  const candidates = profile.scored.filter((entry) => entry.average !== null);
  if (!candidates.length) return null;

  let best = candidates[0];
  let bestDelta = best.score * 10 - best.average;

  for (const entry of candidates) {
    const delta = entry.score * 10 - entry.average;
    if (delta > bestDelta) {
      best = entry;
      bestDelta = delta;
    }
  }

  return best;
}

/**
 * Mean absolute gap between your score and the community average, in points.
 * A plain-language "how contrarian are you" number for the card.
 */
export function contrarianIndex(profile) {
  const rows = profile.scored.filter((entry) => entry.average !== null);
  if (!rows.length) return null;

  const total = rows.reduce(
    (sum, entry) => sum + Math.abs(entry.score * 10 - entry.average),
    0
  );
  return Math.round(total / rows.length);
}
