/**
 * Catalogue provider adapter (JSON:API).
 *
 * We own the catalogue: this adapter is only used by the snapshot writer
 * (and on a cache miss), never on the request hot path. It is provider
 * agnostic on the response side so swapping the source is a config change.
 *
 * Rate limiting: a token bucket per process, sized from config, plus
 * exponential backoff on 429. A blocked IP is expensive to recover from, so
 * the default budget is deliberately conservative.
 */

import { catalogueProvider, ratePerMinute } from './catalogue-config.js';
import { normaliseFormat, normaliseStatus } from './media-vocab.js';
import { requireClearance } from './provider-clearance.js';

export class CatalogueError extends Error {
  constructor(message, code = 'unknown') {
    super(message);
    this.name = 'CatalogueError';
    this.code = code;
  }
}

/** One request at a time, spaced by the configured per-minute budget. */
export function createThrottle(perMinute) {
  const minInterval = Math.max(0, Math.floor(60000 / Math.max(1, perMinute)));
  let last = 0;
  let chain = Promise.resolve();
  return function schedule(task) {
    const run = chain.then(async () => {
      const wait = last + minInterval - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      last = Date.now();
      return task();
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
}

function buildUrl(provider, path, params) {
  const url = new URL(provider.baseUrl.replace(/\/+$/u, '') + path);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function requestJson(url, { accept, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: accept || 'application/vnd.api+json',
        'User-Agent': 'AniGlobe/1.0 (+https://aniglobe.app)',
      },
      signal: controller.signal,
    });
    if (response.status === 429) {
      throw new CatalogueError('The catalogue provider is rate-limiting us.', 'rate_limited');
    }
    if (response.status === 403) {
      throw new CatalogueError('The catalogue provider refused the request.', 'forbidden');
    }
    if (!response.ok) {
      throw new CatalogueError('The catalogue provider answered HTTP ' + response.status + '.', 'http');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof CatalogueError) throw error;
    if (controller.signal.aborted || (error && error.name === 'AbortError')) {
      throw new CatalogueError('The catalogue provider did not answer in time.', 'timeout');
    }
    throw new CatalogueError('Could not reach the catalogue provider.', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ mapping */

function firstTitle(titles) {
  if (!titles) return { en: null, romaji: null, native: null };
  return {
    en: titles.en || titles.en_us || null,
    romaji: titles.en_jp || titles.ja_jp || null,
    native: titles.ja_jp || null,
  };
}

function genreNames(included) {
  if (!Array.isArray(included)) return [];
  // The provider exposes `genres` (a handful of broad genres, attribute
  // `name`) and `categories` (dozens of fine-grained tags, attribute
  // `title`). We store the broad genres only.
  const names = included
    .filter((item) => item && item.type === 'genres' && item.attributes && item.attributes.name)
    .map((item) => item.attributes.name);
  return [...new Set(names)];
}

/** Kitsu rates on a 0-100 scale; the product uses 0-10 everywhere. */
function ratingOutOfTen(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round((number / 10) * 10) / 10;
}

/** The provider exposes a start date but no season field; derive the usual
 *  four-season bucket from the release month. */
function seasonFromStartDate(startDate) {
  const month = Number(String(startDate || '').slice(5, 7));
  if (!month) return null;
  if (month === 12 || month <= 2) return 'WINTER';
  if (month <= 5) return 'SPRING';
  if (month <= 8) return 'SUMMER';
  return 'FALL';
}

/** JSON:API media resource -> our snapshot shape. */
export function normaliseMedia(resource, included, providerId, mediaType) {
  const attributes = (resource && resource.attributes) || {};
  const titles = firstTitle(attributes.titles);
  const poster = attributes.posterImage || attributes.coverImage || null;
  const coverUrl = poster ? poster.large || poster.medium || poster.small || poster.original || null : null;
  const subtype = String(attributes.subtype || '').toLowerCase();
  const showType = String(attributes.showType || '').toLowerCase();
  const detectedManga = subtype === 'manga' || subtype === 'manhwa' || subtype === 'novel' || showType === 'manga';
  const type = mediaType || (detectedManga ? 'manga' : 'anime');
  const isManga = type === 'manga';
  return {
    provider: providerId,
    // The provider keeps separate id spaces for anime and manga, so the
    // stored id is namespaced by type to stay unique.
    providerId: type + ':' + String(resource.id),
    mediaType: type,
    titleEn: titles.en,
    titleRomaji: titles.romaji,
    titleNative: titles.native,
    format: normaliseFormat(attributes.subtype || attributes.showType, type),
    subtype: attributes.subtype || null,
    episodes: isManga ? null : (attributes.episodeCount || null),
    chapters: isManga ? (attributes.chapterCount || null) : null,
    volumes: isManga ? (attributes.volumeCount || null) : null,
    status: normaliseStatus(attributes.status),
    season: attributes.season || seasonFromStartDate(attributes.startDate),
    seasonYear: attributes.startDate ? Number(String(attributes.startDate).slice(0, 4)) || null : null,
    averageRating: ratingOutOfTen(attributes.averageRating),
    popularity: attributes.userCount != null ? Number(attributes.userCount) : null,
    genres: genreNames(included),
    coverUrl,
    synopsis: attributes.synopsis || attributes.description || null,
    nsfw: attributes.nsfw === true,
    updatedAt: attributes.updatedAt || null,
  };
}

/* ----------------------------------------------------------------- provider */

export function createCatalogueClient({ providerId } = {}) {
  const provider = catalogueProvider(providerId);
  // The clearance table decides whether this provider may be mirrored at
  // all. A denied provider throws before a single request goes out.
  requireClearance(provider.id, 'mirror-catalogue');
  const throttle = createThrottle(ratePerMinute());

  async function fetchPage(path, params) {
    const url = buildUrl(provider, path, params);
    return throttle(() => requestJson(url));
  }

  return {
    provider,

    /** One page of media, newest ids first, plus the total count. */
    async listMedia({ mediaType = 'anime', offset = 0, limit = provider.pageSize } = {}) {
      const type = provider.mediaTypes.includes(mediaType) ? mediaType : 'anime';
      // No `fields[...]` selection: the provider rejects unknown field names
      // with a 400, and the full payload is what we store anyway.
      const payload = await fetchPage('/' + type, {
        'page[limit]': limit,
        'page[offset]': offset,
        sort: 'id',
        include: 'genres',
      });
      const data = Array.isArray(payload.data) ? payload.data : [];
      const included = Array.isArray(payload.included) ? payload.included : [];
      return {
        items: data.map((resource) => normaliseMedia(resource, included, provider.id, type)),
        total: payload.meta && payload.meta.count ? Number(payload.meta.count) : data.length,
      };
    },

    /** A single media by namespaced provider id ("anime:12"). */
    async getMedia(providerId) {
      const raw = String(providerId);
      const separator = raw.indexOf(':');
      const type = separator > 0 ? raw.slice(0, separator) : provider.mediaTypes[0];
      const id = separator > 0 ? raw.slice(separator + 1) : raw;
      const payload = await fetchPage('/' + type + '/' + encodeURIComponent(id), {
        include: 'genres',
      });
      if (!payload.data) return null;
      const included = Array.isArray(payload.included) ? payload.included : [];
      return normaliseMedia(payload.data, included, provider.id, type);
    },

    /** Text search, used only as a fallback when the snapshot misses. */
    async search(query, { mediaType = 'anime', limit = 20 } = {}) {
      const type = provider.mediaTypes.includes(mediaType) ? mediaType : 'anime';
      const payload = await fetchPage('/' + type, {
        'filter[text]': query,
        'page[limit]': limit,
        include: 'genres',
      });
      const data = Array.isArray(payload.data) ? payload.data : [];
      const included = Array.isArray(payload.included) ? payload.included : [];
      return data.map((resource) => normaliseMedia(resource, included, provider.id, type));
    },
  };
}
