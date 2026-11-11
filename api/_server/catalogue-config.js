/**
 * Catalogue configuration (server side).
 *
 * Everything is env-driven: no provider URL, key, or limit is hard-coded in
 * the source. The catalogue provider is the one whose terms permit mirroring
 * (see artifacts/output/03-strategy/product-spec.md §8). AniList is not used
 * for the tracker: its Terms of Use forbid mass collection, using the API as
 * a data store, and tracker-shaped use.
 *
 * Only providers cleared for "mirror-catalogue" in provider-clearance.js are
 * listed here. MyAnimeList and Jikan are not: the table records why.
 */

import { isCleared } from './provider-clearance.js';

export const CATALOGUE_PROVIDERS = {
  kitsu: {
    id: 'kitsu',
    label: 'Kitsu',
    // Kitsu moved from kitsu.io to kitsu.app; both hosts serve the same API.
    baseUrl: process.env.KITSUU_BASE_URL || 'https://kitsu.app/api/edge',
    // JSON:API caps page[limit] at 20 on most routes.
    pageSize: Number(process.env.KITSUU_PAGE_SIZE || 20),
    mediaTypes: ['anime', 'manga'],
  },
};

export function catalogueProvider(id) {
  const key = String(process.env.CATALOGUE_PROVIDER || 'kitsu');
  const provider = CATALOGUE_PROVIDERS[key];
  if (!provider) {
    throw new Error('Unknown catalogue provider: ' + key);
  }
  if (!isCleared(provider.id, 'mirror-catalogue')) {
    throw new Error('The clearance table does not allow ' + provider.label + ' to be mirrored.');
  }
  return provider;
}

/** The configured provider id (used where only the id is needed). */
export function catalogueProviderId() {
  return catalogueProvider().id;
}

/**
 * Requests per minute the snapshot writer may issue. Deliberately
 * conservative: providers document both a nominal limit and a degraded one,
 * and a blocked IP is expensive to recover from.
 */
export function ratePerMinute() {
  return Number(process.env.CATALOGUE_RATE_PER_MINUTE || 240);
}

/** How long a snapshot row stays fresh before the writer refreshes it. */
export function snapshotTtlMs() {
  // Long enough that the refresh pass can walk the whole catalogue before
  // anything goes stale: the refresh covers it in about three months.
  return Number(process.env.CATALOGUE_TTL_HOURS || 2160) * 60 * 60 * 1000;
}

/** Rows fetched per sync run, so a crawl cannot monopolise the instance. */
export function syncBatchSize() {
  return Number(process.env.CATALOGUE_SYNC_BATCH || 20000);
}

/**
 * How long one sync run may take, in seconds.
 *
 * A serverless function has a hard wall clock (60 seconds on Vercel), so a
 * run has to stop before the platform kills it. The run is resumable: the
 * cursor it leaves behind is where the next run continues.
 */
export function syncBudgetSeconds() {
  return Number(process.env.CATALOGUE_SYNC_BUDGET_SECONDS || 45);
}

/** Shared secret required by the snapshot trigger endpoint. */
export function cronSecret() {
  return process.env.CRON_SECRET || '';
}

/**
 * The secret a request carries, in any of the three shapes we accept:
 * the x-cron-secret header (curl), an Authorization: Bearer header (Vercel
 * Cron sends it that way when CRON_SECRET is set in the project), or a
 * query parameter (for a platform that can only issue a plain GET).
 */
export function requestCronSecret(req, url) {
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  return String(req.headers['x-cron-secret'] || bearer || url.searchParams.get('secret') || '');
}
