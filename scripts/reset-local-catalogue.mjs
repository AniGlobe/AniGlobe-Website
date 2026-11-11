import { openDatabase } from '../api/_server/db.js';

const { db, catalogueDb } = await openDatabase('file:data/aniglobe.db');
for (const table of ['media_genre_tokens', 'media_tags', 'media_search_tokens', 'media_id_map', 'media', 'catalogue_cursors']) {
  await catalogueDb.execute(`DELETE FROM ${table}`);
}
console.log('catalogue cleared');
await db.close();
