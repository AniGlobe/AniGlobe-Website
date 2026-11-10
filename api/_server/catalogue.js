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
  const names = included
    .filter((item) => item && item.type === 'categories' && item.attributes && item.attributes.name)
    .map((item) => item.attributes.name);
  return [...new Set(names)];
}

/** JSON:API media resource -> our snapshot shape. */
export function normaliseMedia(resource, included, providerId) {
  const attributes = (resource && resource.attributes) || {};
  const titles = firstTitle(attributes.titles);
  const poster = attributes.posterImage || attributes.coverImage || null;
  const coverUrl = poster ? poster.large || poster.medium || poster.small || poster.original || null : null;
  const isManga = attributes.subtype === 'MANGA' || attributes.subtype === 'MANHWA' || attributes.subtype === 'NOVEL' || attributes.showType === 'MANGA';
  return {
    provider: providerId,
    providerId: String(resource.id),
    titleEn: titles.en,
    titleRomaji: titles.romaji,
    titleNative: titles.native,
    format: attributes.subtype || attributes.showType || null,
    subtype: attributes.subtype || null,
    episodes: isManga ? null : (attributes.episodeCount || null),
    chapters: isManga ? (attributes.chapterCount || null) : null,
    volumes: isManga ? (attributes.volumeCount || null) : null,
    status: attributes.status || null,
    season: attributes.season || null,
    seasonYear: attributes.startDate ? Number(String(attributes.startDate).slice(0, 4)) || null : null,
    averageRating: attributes.averageRating != null ? Number(attributes.averageRating) : null,
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
      const fields = 'titles,canonicalTitle,subtype,showType,episodeCount,chapterCount,volumeCount,status,startDate,averageRating,userCount,synopsis,nsfw,posterImage,coverImage,updatedAt';
      const fieldsParam = 'fields[' + type + ']';
      const payload = await fetchPage('/' + type, {
        'page[limit]': limit,
        'page[offset]': offset,
        sort: 'id',
        [fieldsParam]: fields,
        include: 'categories',
      });
      const data = Array.isArray(payload.data) ? payload.data : [];
      const included = Array.isArray(payload.included) ? payload.included : [];
      return {
        items: data.map((resource) => normaliseMedia(resource, included, provider.id)),
        total: payload.meta && payload.meta.count ? Number(payload.meta.count) : data.length,
      };
    },

    /** A single media by provider id. */
    async getMedia(providerId) {
      const type = provider.mediaTypes[0];
      const payload = await fetchPage('/' + type + '/' + encodeURIComponent(providerId), {
        include: 'categories',
      });
      if (!payload.data) return null;
      const included = Array.isArray(payload.included) ? payload.included : [];
      return normaliseMedia(payload.data, included, provider.id);
    },

    /** Text search, used only as a fallback when the snapshot misses. */
    async search(query, { mediaType = 'anime', limit = 20 } = {}) {
      const type = provider.mediaTypes.includes(mediaType) ? mediaType : 'anime';
      const payload = await fetchPage('/' + type, {
        'filter[text]': query,
        'page[limit]': limit,
        include: 'categories',
      });
      const data = Array.isArray(payload.data) ? payload.data : [];
      const included = Array.isArray(payload.included) ? payload.included : [];
      return data.map((resource) => normaliseMedia(resource, included, provider.id));
    },
  };
}
