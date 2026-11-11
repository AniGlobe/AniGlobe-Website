import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/aniglobe.db', { readOnly: true });
console.log('media:', db.prepare('SELECT COUNT(*) AS n FROM media').get().n);
console.log('anime:', db.prepare("SELECT COUNT(*) AS n FROM media WHERE media_type = 'anime'").get().n);
console.log('manga:', db.prepare("SELECT COUNT(*) AS n FROM media WHERE media_type = 'manga'").get().n);
console.log('rows with tags:', db.prepare("SELECT COUNT(*) AS n FROM media WHERE tags IS NOT NULL AND tags <> '[]'").get().n);
console.log('tag rows:', db.prepare('SELECT COUNT(*) AS n FROM media_tags').get().n);
console.log('sample:', JSON.stringify(db.prepare('SELECT title_en, tags FROM media WHERE tags IS NOT NULL AND tags <> \'[]\' LIMIT 2').all()));
