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
  getSyncWatermark,
  listMediaIdsForSync,
  listStaleMedia,
  normaliseTitle,
  recordSyncRun,
  tokeniseTitle,
  upsertMedia,
} from './db.js';
import { createCatalogueClient } from './catalogue.js';
import { snapshotTtlMs, syncBatchSize } from './catalogue-config.js';

function snapshotShape(media, ttlMs) {
  const titleForSearch = media.titleEn || media.titleRomaji || media.titleNative || '';
  return {
    ...media,
    titleNorm: normaliseTitle(titleForSearch),
    genres: JSON.stringify(media.genres || []),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

/**
 * One incremental sync run: fetch ids above the watermark, refresh expired
 * rows, write them into the snapshot. Returns a run report.
 */
export async function runCatalogueSync(db, { providerId, mediaType = 'anime', limit = syncBatchSize() } = {}) {
  const client = createCatalogueClient({ providerId });
  const provider = client.provider;
  const ttlMs = snapshotTtlMs();
  const startedAt = new Date().toISOString();
  const report = { provider: provider.id, startedAt, finishedAt: null, fetched: 0, updated: 0, skipped: 0, error: null };

  try {
    const watermark = await getSyncWatermark(db, provider.id, mediaType);
    const fresh = await listMediaIdsForSync(db, provider.id, mediaType, watermark, limit);
    const stale = await listStaleMedia(db, provider.id, mediaType, new Date().toISOString(), limit);
    const seen = new Set();
    const ids = [];
    for (const id of [...fresh, ...stale]) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length >= limit) break;
    }

    if (!ids.length) {
      // Nothing new and nothing expired: make sure the catalogue exists at
      // all by seeding the first page.
      const page = await client.listMedia({ mediaType, offset: 0, limit: provider.pageSize });
      for (const media of page.items) {
        await writeMedia(db, media, ttlMs);
        report.fetched += 1;
        report.updated += 1;
      }
      report.skipped = Math.max(0, page.total - report.fetched);
      report.finishedAt = new Date().toISOString();
      await recordSyncRun(db, report);
      return report;
    }

    for (const id of ids) {
      try {
        const media = await client.getMedia(id);
        if (!media) {
          report.skipped += 1;
          continue;
        }
        await writeMedia(db, media, ttlMs);
        report.fetched += 1;
        report.updated += 1;
      } catch (error) {
        if (error && error.code === 'rate_limited') {
          // Stop the run on a rate limit; the next run resumes from the
          // watermark instead of hammering the provider.
          report.error = 'rate_limited';
          break;
        }
        report.skipped += 1;
      }
    }
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.error = error && error.message ? String(error.message) : 'unknown error';
    report.finishedAt = new Date().toISOString();
  }

  await recordSyncRun(db, report);
  return report;
}

async function writeMedia(db, media, ttlMs) {
  const shape = snapshotShape(media, ttlMs);
  const tokens = tokeniseTitle(media.titleEn || media.titleRomaji || media.titleNative);
  let genreTokens = [];
  try {
    const parsed = JSON.parse(String(media.genres || '[]'));
    if (Array.isArray(parsed)) genreTokens = parsed.filter((g) => typeof g === 'string' && g);
  } catch {
    genreTokens = [];
  }
  return upsertMedia(db, shape, tokens, genreTokens);
}

/**
 * Browse the snapshot with filters, sorting, and pagination.
 * Every filter is served by an index (media_type, season_year, popularity,
 * average_rating, format, season, genre token table) so a browse never
 * scans the whole catalogue.
 */
export async function browseMedia(db, {
  mediaType = null,
  genre = null,
  format = null,
  year = null,
  season = null,
  status = null,
  sort = 'popularity',
  limit = 24,
  offset = 0,
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

  let join = '';
  if (genre) {
    join = 'JOIN media_genre_tokens g ON g.media_id = m.id AND g.genre = ?';
    args.unshift(genre);
  }

  const order = {
    popularity: 'm.popularity DESC NULLS LAST',
    rating: 'm.average_rating DESC NULLS LAST',
    year: 'm.season_year DESC NULLS LAST',
    title: 'm.title_norm ASC',
    newest: 'm.id DESC',
  }[sort] || 'm.popularity DESC NULLS LAST';

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const safeOrder = order.replace(/NULLS LAST/g, '');

  const countRow = await db.execute(
    `SELECT COUNT(*) AS n FROM media m ${join} ${clause}`,
    args
  );
  const total = Number(countRow.rows[0] ? countRow.rows[0].n : 0);

  const rows = await db.execute(
    `SELECT m.* FROM media m ${join} ${clause} ORDER BY ${safeOrder} LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  return {
    total,
    items: rows.rows.map((row) => shapeMedia(row)),
  };
}

/** Distinct values for the browse filters, from the snapshot itself. */
export async function browseFacets(db, mediaType = null) {
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
  const seasons = await db.execute(
    `SELECT season AS value, COUNT(*) AS n FROM media ${typeClause ? typeClause + ' AND' : 'WHERE'} season IS NOT NULL GROUP BY season ORDER BY n DESC`,
    typeArgs
  );
  return {
    formats: formats.rows.map((row) => ({ value: row.value, count: Number(row.n) })),
    years: years.rows.map((row) => ({ value: Number(row.value), count: Number(row.n) })),
    genres: genres.rows.map((row) => ({ value: row.value, count: Number(row.n) })),
    seasons: seasons.rows.map((row) => ({ value: row.value, count: Number(row.n) })),
  };
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
  try {
    const parsed = JSON.parse(String(row.genres || '[]'));
    if (Array.isArray(parsed)) genres = parsed;
  } catch {
    genres = [];
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
