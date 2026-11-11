/**
 * Fill the catalogue snapshot.
 *
 * The deployed sync trigger stops when the platform's wall clock says so
 * (60 seconds on Vercel), so the scheduled job only ever adds a slice of
 * the catalogue. This script does the same work without that limit: point
 * it at the production database and it crawls until the catalogue is full.
 *
 * Usage:
 *   $env:DATABASE_URL = "libsql://aniglobe-xxx.turso.io"
 *   $env:DATABASE_AUTH_TOKEN = "<token>"
 *   node scripts/fill-catalogue.mjs            # both anime and manga
 *   node scripts/fill-catalogue.mjs anime      # one media type
 *
 * Settings (all optional):
 *   CATALOGUE_RATE_PER_MINUTE       requests per minute to the provider (240)
 *   CATALOGUE_SYNC_BUDGET_SECONDS   seconds per run before it pauses (300)
 *   CATALOGUE_SYNC_BATCH            rows per run (20000)
 */

import { openDatabase } from '../api/_server/db.js';
import { runCatalogueSync } from '../api/_server/catalogue-store.js';
import { syncBatchSize } from '../api/_server/catalogue-config.js';

const only = process.argv[2];
const mediaTypes = only ? [only] : ['anime', 'manga'];
const limit = syncBatchSize();
// There is no function wall clock here, so a run may be much longer.
const budgetSeconds = Number(process.env.CATALOGUE_SYNC_BUDGET_SECONDS || 300);

const db = await openDatabase();

for (const mediaType of mediaTypes) {
  process.stdout.write(`\n${mediaType}: filling\n`);
  let more = true;
  while (more) {
    const report = await runCatalogueSync(db, { mediaType, limit, budgetSeconds });
    const done = report.cursor;
    const total = report.total || '?';
    process.stdout.write(
      `  fetched ${report.fetched}, at ${done}/${total}, ${report.mode}` +
        (report.error ? `, error: ${report.error}` : '') + '\n'
    );
    if (report.error) {
      process.exitCode = 1;
      break;
    }
    more = report.more === true;
  }
}

await db.close();
