/**
 * One spelling per concept in the catalogue snapshot.
 *
 * Providers spell the same thing differently and in mixed case (Kitsu sends
 * "TV", "movie", "OVA", "special"), so the writer normalises them once. The
 * snapshot then holds values the filters, the facets, and the UI can all
 * agree on.
 */

/** Anime formats, keyed by the provider's spelling in lower case. */
const ANIME_FORMATS = {
  tv: 'TV',
  tv_short: 'TV Short',
  movie: 'Movie',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Special',
  music: 'Music',
};

/** Manga formats, keyed by the provider's spelling in lower case. */
const MANGA_FORMATS = {
  manga: 'Manga',
  manhwa: 'Manhwa',
  manhua: 'Manhua',
  novel: 'Novel',
  light_novel: 'Novel',
  one_shot: 'One-shot',
  oneshot: 'One-shot',
};

/** Airing states, keyed by the provider's spelling in lower case. */
const STATUSES = {
  current: 'Airing',
  finished: 'Finished',
  pending: 'Upcoming',
  tba: 'TBA',
  paused: 'Hiatus',
  relic: 'Ended',
};

function key(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * The canonical format label for a provider value.
 * Unknown values are kept as-is (title cased) so a new provider format
 * still shows up instead of disappearing.
 */
export function normaliseFormat(raw, mediaType) {
  const table = mediaType === 'manga' ? MANGA_FORMATS : ANIME_FORMATS;
  const lookup = key(raw);
  if (!lookup) return null;
  if (table[lookup]) return table[lookup];
  if (ANIME_FORMATS[lookup]) return ANIME_FORMATS[lookup];
  if (MANGA_FORMATS[lookup]) return MANGA_FORMATS[lookup];
  return String(raw).trim();
}

/** The canonical airing state for a provider value. */
export function normaliseStatus(raw) {
  const lookup = key(raw);
  if (!lookup) return null;
  return STATUSES[lookup] || String(raw).trim();
}

/** The label for a status already stored in the snapshot. */
export function statusLabel(value) {
  if (!value) return null;
  return STATUSES[key(value)] || value;
}

/** Every status label we know about, in browse order. */
export const STATUS_VALUES = ['Airing', 'Finished', 'Upcoming', 'Hiatus', 'TBA', 'Ended'];
