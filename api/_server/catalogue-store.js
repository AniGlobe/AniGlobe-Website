/**
 * Catalogue snapshot writer + search.
 *
 * The snapshot is ours: search and detail read from it, so the provider is
 * only called by the writer (or on a cache miss). The writer is incremental
 * (id watermark + expired rows) and resumable; it never runs on the request
 * path.
 */

import {
  getMediaByProviderId,
  getCatalogueCursor,
  setCatalogueCursor,
  getSyncWatermark,
  listMediaIdsForSync,
  listStaleMedia,
  normaliseTitle,
  recordSyncRun,
  tokeniseTitle,
  upsertMedia,
  writeMediaBatch,
} from './db.js';
import { createCatalogueClient } from './catalogue.js';
import { snapshotTtlMs, syncBatchSize, syncBudgetSeconds } from './catalogue-config.js';

/** How often the filter counts are rebuilt, in milliseconds. */
const FACET_REBUILD_INTERVAL_MS = 10 * 60 * 1000;

function snapshotShape(media, ttlMs) {
  const titleForSearch = media.titleEn || media.titleRomaji || media.titleNative || '';
  return {
    ...media,
    titleNorm: normaliseTitle(titleForSearch),
    genres: JSON.stringify(media.genres || []),
    tags: JSON.stringify(media.tags || []),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

/**
 * One incremental sync run.
 *
 * The run has two phases and a wall clock:
 *
 *   crawl   walks the provider's listing forward from the stored cursor and
 *           writes each page. The cursor is saved after every page, so a run
 *           that is cut short (a serverless function has a hard timeout)
 *           still leaves the next run somewhere to continue.
 *   refresh walks the listing again to renew rows that went stale. It runs
 *           only once the crawl has reached the end, and it rotates so every
 *           page is refreshed over several runs.
 *
 * The run stops at whichever limit comes first: the row cap, the time
 * budget, or the end of the listing.
 */
export async function runCatalogueSync(db, {
  providerId,
  mediaType = 'anime',
  limit = syncBatchSize(),
  budgetSeconds = syncBudgetSeconds(),
} = {}) {
  const client = createCatalogueClient({ providerId });
  const provider = client.provider;
  const ttlMs = snapshotTtlMs();
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + Math.max(5, budgetSeconds) * 1000;
  const report = {
    provider: provider.id,
    mediaType,
    startedAt,
    finishedAt: null,
    fetched: 0,
    updated: 0,
    skipped: 0,
    error: null,
    mode: 'crawl',
    cursor: 0,
    total: null,
    more: false,
  };

  try {
    let cursor = await getCatalogueCursor(db, provider.id, mediaType, 'crawl');
    report.cursor = cursor;

    // --- crawl: walk the listing forward, one page at a time -------------
    while (report.fetched < limit && Date.now() < deadline) {
      const page = await client.listMedia({ mediaType, offset: cursor, limit: provider.pageSize });
      if (report.total === null) report.total = page.total;
      if (!page.items.length) break;
      await writeMediaPage(db, page.items, ttlMs);
      report.fetched += page.items.length;
      report.updated += page.items.length;
      cursor += page.items.length;
      await setCatalogueCursor(db, provider.id, mediaType, 'crawl', cursor);
      report.cursor = cursor;
      if (report.total && cursor >= report.total) break;
      report.more = true;
    }

    // --- refresh: renew stale rows, but only once the crawl is done ------
    const caughtUp = report.total !== null && report.cursor >= report.total;
    if (caughtUp && Date.now() < deadline) {
      report.mode = 'refresh';
      const refreshCursor = await getCatalogueCursor(db, provider.id, mediaType, 'refresh');
      const page = await client.listMedia({ mediaType, offset: refreshCursor, limit: provider.pageSize });
      if (page.items.length) {
        await writeMediaPage(db, page.items, ttlMs);
        report.fetched += page.items.length;
        report.updated += page.items.length;
        await setCatalogueCursor(db, provider.id, mediaType, 'refresh', refreshCursor + page.items.length);
      } else {
        // The end of the listing: start the rotation again.
        await setCatalogueCursor(db, provider.id, mediaType, 'refresh', 0);
      }
    }

    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.error = error && error.message ? String(error.message) : 'unknown error';
    report.finishedAt = new Date().toISOString();
  }

  await recordSyncRun(db, report);
  // The filter menu is served from cached counts, so they have to be brought
  // up to date after the catalogue changed. Rebuilding reads the snapshot
  // once, so it is rate limited rather than done on every run.
  if (report.fetched > 0) {
    try {
      await refreshFacets(db, provider.id, mediaType);
    } catch (error) {
      report.facetError = error && error.message ? String(error.message).slice(0, 120) : 'unknown error';
    }
  }
  return report;
}

/** Rebuild the facet counts, at most once every few minutes. */
async function refreshFacets(db, provider, mediaType) {
  const last = await getCatalogueCursor(db, provider, mediaType, 'facets');
  const now = Date.now();
  if (last && now - last < FACET_REBUILD_INTERVAL_MS) return false;
  await rebuildFacets(db);
  await setCatalogueCursor(db, provider, mediaType, 'facets', now);
  return true;
}

async function writeMedia(db, media, ttlMs) {
  const shape = snapshotShape(media, ttlMs);
  const tokens = tokeniseTitle(media.titleEn || media.titleRomaji || media.titleNative);
  const genreTokens = Array.isArray(media.genres)
    ? media.genres.filter((genre) => typeof genre === 'string' && genre)
    : [];
  const tagTokens = Array.isArray(media.tags)
    ? media.tags.filter((tag) => typeof tag === 'string' && tag)
    : [];
  return upsertMedia(db, shape, tokens, genreTokens, tagTokens);
}

/** Write a whole provider page in two round trips. */
async function writeMediaPage(db, page, ttlMs) {
  const items = page.map((media) => {
    const shape = snapshotShape(media, ttlMs);
    return {
      media: shape,
      tokens: tokeniseTitle(media.titleEn || media.titleRomaji || media.titleNative),
      genreTokens: Array.isArray(media.genres)
        ? media.genres.filter((genre) => typeof genre === 'string' && genre)
        : [],
      tagTokens: Array.isArray(media.tags)
        ? media.tags.filter((tag) => typeof tag === 'string' && tag)
        : [],
    };
  });
  return writeMediaBatch(db, items);
}

/**
 * Browse the snapshot with filters, sorting, and pagination.
 * Every filter is served by an index (media_type, season_year, popularity,
 * average_rating, format, season, genre token table, title tokens) so a
 * browse never scans the whole catalogue.
 */
export async function browseMedia(db, {
  mediaType = null,
  query = '',
  genre = null,
  genres = [],
  tags = [],
  format = null,
  year = null,
  season = null,
  status = null,
  minScore = null,
  sort = 'popularity',
  limit = 24,
  offset = 0,
  countCap = 1000,
} = {}) {
  const where = [];
  const args = [];

  if (mediaType) {
    where.push('m.media_type = ?');
    args.push(mediaType);
  }
  if (year) {
    where.push('m.season_year = ?');
    args.push(Number(year));
  }
  if (format) {
    where.push('m.format = ?');
    args.push(format);
  }
  if (season) {
    where.push('m.season = ?');
    args.push(season);
  }
  if (status) {
    where.push('m.media_status = ?');
    args.push(status);
  }
  if (minScore != null) {
    where.push('m.average_rating >= ?');
    args.push(Number(minScore));
  }

  // Title words go through the inverted token index: every word has to be
  // present, so "cowboy bebop" finds the title and not every "cowboy".
  const tokens = tokeniseTitle(query);
  if (tokens.length) {
    where.push(`m.id IN (
      SELECT media_id FROM media_search_tokens
      WHERE token IN (${tokens.map(() => '?').join(', ')})
      GROUP BY media_id
      HAVING COUNT(DISTINCT token) = ?
    )`);
    args.push(...tokens, tokens.length);
  }

  // Several genres match any of them; the EXISTS keeps one row per title.
  const genreList = Array.isArray(genres) ? genres.filter(Boolean) : (genre ? [genre] : []);
  if (genreList.length) {
    where.push(`EXISTS (
      SELECT 1 FROM media_genre_tokens g
      WHERE g.media_id = m.id AND g.genre IN (${genreList.map(() => '?').join(', ')})
    )`);
    args.push(...genreList);
  }

  // The fine-grained tags work the same way, and are kept apart from the
  // genres: a title can have a genre and still be missing any of the tags
  // the visitor picked.
  const tagList = (Array.isArray(tags) ? tags : []).filter(Boolean);
  if (tagList.length) {
    where.push(`EXISTS (
      SELECT 1 FROM media_tags t
      WHERE t.media_id = m.id AND t.tag IN (${tagList.map(() => '?').join(', ')})
    )`);
    args.push(...tagList);
  }

  const order = {
    popularity: 'm.popularity DESC',
    rating: 'm.average_rating DESC',
    year: 'm.season_year DESC',
    title: 'm.title_norm ASC',
    newest: 'm.id DESC',
  }[sort] || 'm.popularity DESC';

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // The count is capped: counting every matching row reads the whole
  // filtered set, which is the one thing a browse must never do. Past the
  // cap the answer is "more than the cap", and the page says so.
  const countRow = await db.execute(
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM media m ${clause} LIMIT ?)`,
    [...args, countCap + 1]
  );
  const counted = Number(countRow.rows[0] ? countRow.rows[0].n : 0);
  const totalCapped = counted > countCap;
  const total = totalCapped ? countCap : counted;

  const rows = await db.execute(
    `SELECT m.* FROM media m ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  return {
    total,
    totalCapped,
    items: rows.rows.map((row) => shapeMedia(row)),
  };
}

/**
 * Rebuild the facet counts.
 *
 * The counts are the browse page's filter menu. Asking the snapshot for
 * them means a GROUP BY over every row, and the genre one scans the whole
 * genre-token table: about two million rows read per page view. The counts
 * are kept in a small table instead and rebuilt by the writer.
 */
export async function rebuildFacets(db) {
  const dimensions = [
    {
      name: 'total',
      sql: `SELECT media_type, 'total' AS dimension, '*' AS value, COUNT(*) AS n
            FROM media GROUP BY media_type`,
    },
    {
      name: 'format',
      sql: `SELECT media_type, 'format' AS dimension, format AS value, COUNT(*) AS n
            FROM media WHERE format IS NOT NULL GROUP BY media_type, format`,
    },
    {
      name: 'year',
      sql: `SELECT media_type, 'year' AS dimension, CAST(season_year AS TEXT) AS value, COUNT(*) AS n
            FROM media WHERE season_year IS NOT NULL GROUP BY media_type, season_year`,
    },
    {
      name: 'season',
      sql: `SELECT media_type, 'season' AS dimension, season AS value, COUNT(*) AS n
            FROM media WHERE season IS NOT NULL GROUP BY media_type, season`,
    },
    {
      name: 'status',
      sql: `SELECT media_type, 'status' AS dimension, media_status AS value, COUNT(*) AS n
            FROM media WHERE media_status IS NOT NULL GROUP BY media_type, media_status`,
    },
    {
      name: 'genre',
      sql: `SELECT m.media_type, 'genre' AS dimension, g.genre AS value, COUNT(*) AS n
            FROM media_genre_tokens g JOIN media m ON m.id = g.media_id
            GROUP BY m.media_type, g.genre`,
    },
    {
      name: 'tag',
      sql: `SELECT m.media_type, 'tag' AS dimension, t.tag AS value, COUNT(*) AS n
            FROM media_tags t JOIN media m ON m.id = t.media_id
            GROUP BY m.media_type, t.tag`,
    },
  ];

  await db.execute('DELETE FROM catalogue_facets');
  for (const dimension of dimensions) {
    await db.execute(
      `INSERT INTO catalogue_facets (media_type, dimension, value, count)
       SELECT media_type, dimension, value, n FROM (${dimension.sql}) WHERE value IS NOT NULL`
    );
  }
  const rows = await db.execute('SELECT COUNT(*) AS n FROM catalogue_facets');
  return { facets: Number(rows.rows[0] ? rows.rows[0].n : 0) };
}

/**
 * The browse filter menu, from the cached counts.
 *
 * Falls back to counting the snapshot when the cache is empty, which is
 * only the case before the first rebuild.
 */
export async function browseFacets(db, mediaType = null) {
  const cached = await db.execute(
    'SELECT dimension, value, count FROM catalogue_facets WHERE media_type = ?',
    [mediaType || 'anime']
  );
  if (!cached.rows.length) return countFacetsFromSnapshot(db, mediaType);

  const grouped = { formats: [], years: [], genres: [], tags: [], seasons: [], statuses: [], total: 0 };
  for (const row of cached.rows) {
    const count = Number(row.count);
    if (row.dimension === 'format') grouped.formats.push({ value: row.value, count });
    else if (row.dimension === 'year') grouped.years.push({ value: Number(row.value), count });
    else if (row.dimension === 'genre') grouped.genres.push({ value: row.value, count });
    else if (row.dimension === 'tag') grouped.tags.push({ value: row.value, count });
    else if (row.dimension === 'season') grouped.seasons.push({ value: row.value, count });
    else if (row.dimension === 'status') grouped.statuses.push({ value: row.value, count });
    else if (row.dimension === 'total') grouped.total = count;
  }
  grouped.formats.sort((a, b) => b.count - a.count);
  grouped.years.sort((a, b) => b.value - a.value);
  grouped.genres.sort((a, b) => b.count - a.count);
  grouped.tags.sort((a, b) => b.count - a.count);
  grouped.seasons.sort((a, b) => b.count - a.count);
  grouped.statuses.sort((a, b) => b.count - a.count);
  return grouped;
}

/** The same menu, counted straight from the snapshot. Slow, used rarely. */
async function countFacetsFromSnapshot(db, mediaType) {
  const typeClause = mediaType ? 'WHERE media_type = ?' : '';
  const typeArgs = mediaType ? [mediaType] : [];
  const formats = await db.execute(
    `SELECT format AS value, COUNT(*) AS n FROM media ${typeClause} AND format IS NOT NULL GROUP BY format ORDER BY n DESC LIMIT 12`,
    typeArgs
  );
  const years = await db.execute(
    `SELECT season_year AS value, COUNT(*) AS n FROM media ${typeClause ? typeClause + ' AND' : 'WHERE'} season_year IS NOT NULL GROUP BY season_year ORDER BY season_year DESC LIMIT 20`,
    typeArgs
  );
  const genres = await db.execute(
    `SELECT g.genre AS value, COUNT(*) AS n FROM media_genre_tokens g JOIN media m ON m.id = g.media_id ${mediaType ? 'WHERE m.media_type = ?' : ''} GROUP BY g.genre ORDER BY n DESC LIMIT 24`,
    typeArgs
  );
  const tags = await db.execute(
    `SELECT t.tag AS value, COUNT(*) AS n FROM media_tags t JOIN media m ON m.id = t.media_id ${mediaType ? 'WHERE m.media_type = ?' : ''} GROUP BY t.tag ORDER BY n DESC LIMIT 60`,
    typeArgs
  );
  const seasons = await db.execute(
    `SELECT season AS value, COUNT(*) AS n FROM media ${typeClause ? typeClause + ' AND' : 'WHERE'} season IS NOT NULL GROUP BY season ORDER BY n DESC`,
    typeArgs
  );
  const statuses = await db.execute(
    `SELECT media_status AS value, COUNT(*) AS n FROM media ${typeClause ? typeClause + ' AND' : 'WHERE'} media_status IS NOT NULL GROUP BY media_status ORDER BY n DESC`,
    typeArgs
  );
  const total = await db.execute(`SELECT COUNT(*) AS n FROM media ${typeClause}`, typeArgs);
  return {
    formats: formats.rows.map((row) => ({ value: row.value, count: Number(row.n) })),
    years: years.rows.map((row) => ({ value: Number(row.value), count: Number(row.n) })),
    genres: genres.rows.map((row) => ({ value: row.value, count: Number(row.n) })),
    tags: tags.rows.map((row) => ({ value: row.value, count: Number(row.n) })),
    seasons: seasons.rows.map((row) => ({ value: row.value, count: Number(row.n) })),
    statuses: statuses.rows.map((row) => ({ value: row.value, count: Number(row.n) })),
    total: Number(total.rows[0] ? total.rows[0].n : 0),
  };
}

/**
 * Empty the catalogue.
 *
 * The snapshot is rebuildable: the crawl starts again from the first page
 * and the titles come back. The accounts are not touched, and a list keeps
 * reading because every entry carries its own copy of its title.
 */
export async function resetCatalogue(db) {
  const before = await db.execute('SELECT COUNT(*) AS n FROM media');
  const removed = Number(before.rows[0] ? before.rows[0].n : 0);
  for (const table of ['media_genre_tokens', 'media_tags', 'media_search_tokens', 'media_id_map', 'media', 'catalogue_cursors']) {
    await db.execute(`DELETE FROM ${table}`);
  }
  return { removed };
}

/**
 * The titles behind a user's list, fetched in one query.
 *
 * The entries live in the accounts database and the titles in the catalogue
 * database, so a list page has to bring the two together here.
 */
export async function getMediaByIds(db, ids) {
  const wanted = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!wanted.length) return new Map();
  const rows = await db.execute(
    `SELECT * FROM media WHERE id IN (${wanted.map(() => '?').join(', ')})`,
    wanted
  );
  const byId = new Map();
  for (const row of rows.rows) {
    const media = shapeMedia(row);
    byId.set(media.id, media);
  }
  return byId;
}

/**
 * Sort list entries by a title detail.
 *
 * The title lives in the catalogue database and the entry in the accounts
 * one, so a sort by title or year cannot be done in SQL. The whole list is
 * sorted here and paged afterwards.
 */
export function sortEntriesByMedia(entries, titles, sort) {
  const sorted = entries.slice();
  if (sort === 'title') {
    sorted.sort((a, b) => {
      const left = titles.get(a.mediaId);
      const right = titles.get(b.mediaId);
      return String(left ? left.title : '').localeCompare(String(right ? right.title : ''));
    });
  } else if (sort === 'year') {
    sorted.sort((a, b) => {
      const left = titles.get(a.mediaId);
      const right = titles.get(b.mediaId);
      return (right && right.year ? right.year : 0) - (left && left.year ? left.year : 0);
    });
  }
  return sorted;
}

/**
 * Search the snapshot. Token lookup first (indexed, cheap), then a prefix
 * match on the normalised title. A LIKE '%term%' scan is never used: it
 * would burn the hosted database's monthly row-read budget.
 */
export async function searchSnapshot(db, query, { limit = 24 } = {}) {
  const normalised = normaliseTitle(query);
  if (!normalised) return [];
  const tokens = normalised.split(' ').filter(Boolean);
  const ids = new Set();

  for (const token of tokens) {
    const rows = await db.execute(
      'SELECT media_id FROM media_search_tokens WHERE token = ? LIMIT ?',
      [token, limit * 4]
    );
    for (const row of rows.rows) ids.add(Number(row.media_id));
  }

  const prefix = await db.execute(
    'SELECT id FROM media WHERE title_norm LIKE ? ORDER BY (popularity IS NULL), popularity DESC LIMIT ?',
    [normalised + '%', limit]
  );
  for (const row of prefix.rows) ids.add(Number(row.id));

  if (!ids.size) return [];
  const placeholders = [...ids].map(() => '?').join(',');
  const rows = await db.execute(
    `SELECT * FROM media WHERE id IN (${placeholders}) LIMIT ?`,
    [...ids, limit]
  );
  return rows.rows
    .map((row) => shapeMedia(row))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

export function shapeMedia(row) {
  let genres = [];
  let tags = [];
  try {
    const parsed = JSON.parse(String(row.genres || '[]'));
    if (Array.isArray(parsed)) genres = parsed;
  } catch {
    genres = [];
  }
  try {
    const parsed = JSON.parse(String(row.tags || '[]'));
    if (Array.isArray(parsed)) tags = parsed;
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    provider: row.provider,
    providerId: row.provider_id,
    mediaType: row.media_type || null,
    title: row.title_en || row.title_romaji || row.title_native || 'Untitled',
    titleRomaji: row.title_romaji,
    titleNative: row.title_native,
    format: row.format,
    subtype: row.subtype,
    episodes: row.episodes,
    chapters: row.chapters,
    volumes: row.volumes,
    status: row.media_status,
    season: row.season,
    year: row.season_year,
    averageRating: row.average_rating,
    popularity: row.popularity,
    genres,
    tags,
    coverUrl: row.cover_url,
    synopsis: row.synopsis,
    nsfw: row.nsfw === 1,
    updatedAt: row.updated_at,
  };
}

export async function getSnapshotMedia(db, id) {
  const row = await db.execute('SELECT * FROM media WHERE id = ?', [id]);
  if (!row.rows.length) return null;
  return shapeMedia(row.rows[0]);
}

/** Ensure a media row exists for a provider id, fetching it if needed. */
export async function ensureMedia(db, providerId, providerMediaId, client) {
  const existing = await getMediaByProviderId(db, providerId, String(providerMediaId));
  if (existing) return existing.id;
  const media = await client.getMedia(String(providerMediaId));
  if (!media) return null;
  return writeMedia(db, media, snapshotTtlMs());
}
