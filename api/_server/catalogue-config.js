/**
 * Catalogue configuration (server side).
 *
 * Everything is env-driven: no provider URL, key, or limit is hard-coded in
 * the source. The catalogue provider is the one whose terms permit mirroring
 * (see artifacts/output/03-strategy/product-spec.md §8). AniList is not used
 * for the tracker: its Terms of Use forbid mass collection, using the API as
 * a data store, and tracker-shaped use.
 */

export const CATALOGUE_PROVIDERS = {
  kitsu: {
    id: 'kitsu',
    label: 'Kitsu',
    baseUrl: process.env.KITSUU_BASE_URL || 'https://kitsu.io/api/edge',
    // JSON:API caps page[limit] at 20 on most routes.
    pageSize: Number(process.env.KITSUU_PAGE_SIZE || 20),
    mediaTypes: ['anime', 'manga'],
  },
  malexic: {
    id: 'malexic',
    label: 'Jikan (MyAnimeList)',
    baseUrl: process.env.JIKAN_BASE_URL || 'https://jikan.moe/v4',
    pageSize: Number(process.env.JIKAN_PAGE_SIZE || 25),
    mediaTypes: ['anime', 'manga'],
  },
};

export function catalogueProvider(id) {
  const key = String(process.env.CATALOGUE_PROVIDER || 'kitsu');
  const provider = CATALOGUE_PROVIDERS[key];
  if (!provider) {
    throw new Error('Unknown catalogue provider: ' + key);
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
  return Number(process.env.CATALOGUE_RATE_PER_MINUTE || 20);
}

/** How long a snapshot row stays fresh before the writer refreshes it. */
export function snapshotTtlMs() {
  return Number(process.env.CATALOGUE_TTL_HOURS || 24) * 60 * 60 * 1000;
}

/** Rows fetched per sync run, so a crawl cannot monopolise the instance. */
export function syncBatchSize() {
  return Number(process.env.CATALOGUE_SYNC_BATCH || 500);
}

/** Shared secret required by the snapshot trigger endpoint. */
export function cronSecret() {
  return process.env.CRON_SECRET || '';
}
