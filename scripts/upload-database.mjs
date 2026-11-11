/**
 * Upload a locally built database to a hosted one.
 *
 * The catalogue is big and the serverless function has a wall clock, so it is
 * cheaper to build it locally (no time limit) and copy it across. The copy
 * goes table by table in batches, so a large table never sits in memory.
 *
 * Usage:
 *   $env:DATABASE_URL = "libsql://aniglobe-xxx.turso.io"
 *   $env:DATABASE_AUTH_TOKEN = "<token>"
 *   node scripts/upload-database.mjs                    # the catalogue only
 *   node scripts/upload-database.mjs --tables=all       # accounts and catalogue
 *   node scripts/upload-database.mjs --replace          # empty the target first
 *
 * Flags:
 *   --tables=catalogue|all   what to copy (default: catalogue)
 *   --replace                delete the target tables before copying
 *   --source=<path>          the local database (default: data/aniglobe.db)
 *
 * Copy a database that is not being written to: the token tables point at
 * the media rows, so a source that grows mid-copy fails on the foreign key.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { openDatabase } from '../api/_server/db.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const found = args.find((value) => value.startsWith('--' + name + '='));
  return found ? found.slice(name.length + 3) : fallback;
};
const has = (name) => args.includes('--' + name);

const tablesArg = flag('tables', 'catalogue');
const sourcePath = flag('source', 'data/aniglobe.db');
const replace = has('replace');

// The media rows go first: the token tables point at them.
const CATALOGUE_TABLES = [
  'media',
  'media_id_map',
  'media_search_tokens',
  'media_genre_tokens',
  'catalogue_cursors',
  'catalogue_sync_runs',
];
const ACCOUNT_TABLES = [
  'template_likes',
  'templates',
  'wrapped_prefs',
  'guess_progress',
  'oauth_states',
  'library_entries',
  'library_sync_state',
  'sessions',
  'users',
  'rate_limits',
  'schema_migrations',
];

const targetUrl = process.env.DATABASE_URL;
const targetToken = process.env.DATABASE_AUTH_TOKEN;
if (!targetUrl) {
  console.error('Set DATABASE_URL to the hosted database (libsql://...).');
  process.exit(1);
}
if (!existsSync(sourcePath)) {
  console.error('No local database at ' + sourcePath + '. Build it first: node scripts/fill-catalogue.mjs');
  process.exit(1);
}

// The source database is opened read-only so a copy cannot change it.
const local = new DatabaseSync(sourcePath, { readOnly: true });
const remote = createClient({ url: targetUrl, ...(targetToken ? { authToken: targetToken } : {}) });

// The hosted database needs the schema before the rows go in.
const { db: schemaDb } = await openDatabase(targetUrl, targetUrl);
await schemaDb.close();

const tables = tablesArg === 'all' ? [...CATALOGUE_TABLES, ...ACCOUNT_TABLES] : CATALOGUE_TABLES;

for (const table of tables) {
  const columns = local.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.length) continue;
  const quoted = columns.map((name) => '"' + name + '"').join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  if (replace) {
    await remote.execute(`DELETE FROM ${table}`);
  }

  const total = Number(local.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  if (!total) {
    console.log(`${table}: nothing to copy`);
    continue;
  }

  const statement = local.prepare(`SELECT ${quoted} FROM ${table} LIMIT ? OFFSET ?`);
  let copied = 0;
  while (copied < total) {
    const rows = statement.all(500, copied);
    if (!rows.length) break;
    const batch = rows.map((row) => ({
      sql: `INSERT OR REPLACE INTO ${table} (${quoted}) VALUES (${placeholders})`,
      args: columns.map((name) => row[name]),
    }));
    await remote.batch(batch, 'write');
    copied += rows.length;
    process.stdout.write(`\r${table}: ${copied}/${total}`);
  }
  console.log(`\r${table}: ${copied}/${total} copied`);
}

local.close();
remote.close();
console.log('done');
