/**
 * Write a local database out as a SQL file.
 *
 * The file is what a hosted database is loaded from:
 *   turso db shell aniglobe < data/aniglobe-dump.sql
 * The Turso dashboard can import the same file.
 *
 * Usage:
 *   node scripts/dump-database.mjs
 *   node scripts/dump-database.mjs --source=data/aniglobe.db --out=data/aniglobe-dump.sql
 *   node scripts/dump-database.mjs --tables=catalogue
 */

import { DatabaseSync } from 'node:sqlite';
import { createWriteStream, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const found = args.find((value) => value.startsWith('--' + name + '='));
  return found ? found.slice(name.length + 3) : fallback;
};

const sourcePath = flag('source', 'data/aniglobe.db');
const outPath = flag('out', 'data/aniglobe-dump.sql');
const tablesArg = flag('tables', 'all');

// The media rows go first: the token tables point at them.
const CATALOGUE_TABLES = [
  'media',
  'media_id_map',
  'media_search_tokens',
  'media_genre_tokens',
  'catalogue_cursors',
  'catalogue_sync_runs',
];

if (!existsSync(sourcePath)) {
  console.error('No database at ' + sourcePath);
  process.exit(1);
}

const db = new DatabaseSync(sourcePath, { readOnly: true });
const out = createWriteStream(outPath);
const write = (text) => new Promise((resolve, reject) => {
  if (out.write(text)) resolve();
  else out.once('drain', resolve);
  out.once('error', reject);
});

/** A SQL literal for one value. */
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value)) return "X'" + value.toString('hex') + "'";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

await write('PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n');

const schema = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all();
for (const row of schema) {
  await write(row.sql.trim() + ';\n');
}

const tables = schema
  .filter((row) => row.type === 'table' && row.name !== 'schema_migrations')
  .map((row) => row.name)
  .filter((name) => (tablesArg === 'all' ? true : CATALOGUE_TABLES.includes(name)));

for (const table of tables) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.length) continue;
  const quoted = columns.map((name) => '"' + name + '"').join(', ');
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  const statement = db.prepare(`SELECT ${quoted} FROM ${table} LIMIT ? OFFSET ?`);
  let written = 0;
  while (written < total) {
    const rows = statement.all(500, written);
    if (!rows.length) break;
    let chunk = '';
    for (const row of rows) {
      chunk += `INSERT OR REPLACE INTO ${table} (${quoted}) VALUES (${columns.map((name) => literal(row[name])).join(', ')});\n`;
    }
    await write(chunk);
    written += rows.length;
    process.stdout.write(`\r${table}: ${written}/${total}`);
  }
  process.stdout.write(`\r${table}: ${written}/${total} written\n`);
}

await write('COMMIT;\n');
out.end();
await new Promise((resolve) => out.on('close', resolve));
db.close();

const handle = await open(outPath, 'r');
const { size } = await handle.stat();
handle.close();
console.log('wrote ' + outPath + ' (' + Math.round(size / 1024 / 1024) + ' MB)');
