/**
 * Local development server: the API handler plus static file serving for
 * everything else. Production (Vercel) uses api/[...path].js instead and
 * serves static files from the platform.
 *
 * Configuration via environment variables:
 *   PORT            default 8080
 *   HOST            default 0.0.0.0
 *   DATABASE_URL    the accounts database (default: file:<root>/data/aniglobe.db;
 *                   use libsql://... + DATABASE_AUTH_TOKEN for Turso)
 *                   On Vercel, use a durable Turso URL — the default file
 *                   is ephemeral/per-instance.
 *   CATALOGUE_DATABASE_URL
 *                   the anime and manga catalogue database. When it is not
 *                   set, the accounts database holds both.
 *   TRUST_PROXY     set to 1 behind a TLS-terminating proxy (Vercel) so
 *                   X-Forwarded-For/Host are trusted for client IPs and
 *                   reset/verify origins (https).
 *   NODE_ENV        "production" adds Secure to cookies + HSTS header
 */

import { createServer } from 'node:http';

import { openDatabase } from './api/_server/db.js';
import { createDbRateLimiter } from './api/_server/ratelimit.js';
import { createApiRouter } from './api/_server/api.js';
import { createRequestHandler } from './api/_server/handler.js';
import { serveStatic } from './api/_server/static.js';
import { HttpError, sendHttpError } from './api/_server/http.js';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const { db, catalogueDb } = await openDatabase();
const api = createApiRouter({
  db,
  catalogueDb,
  registerLimiter: createDbRateLimiter({ db, windowMs: 15 * 60 * 1000, max: 20 }),
  loginLimiter: createDbRateLimiter({ db, windowMs: 15 * 60 * 1000, max: 30 }),
  resetLimiter: createDbRateLimiter({ db, windowMs: 60 * 60 * 1000, max: 5 }),
});
const requestHandler = createRequestHandler({ db, catalogueDb, api });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://placeholder');
    if (url.pathname.startsWith('/api/')) {
      await requestHandler(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(405, 'That method is not supported here.');
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    if (!res.headersSent) sendHttpError(res, error);
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  const accounts = process.env.DATABASE_URL || '<root>/data/aniglobe.db';
  const catalogue = process.env.CATALOGUE_DATABASE_URL || accounts;
  console.log(`AniGlobe listening at http://${HOST}:${PORT}`);
  console.log(`  accounts:  ${accounts}`);
  console.log(`  catalogue: ${catalogue}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      if (catalogueDb !== db) catalogueDb.close();
      process.exit(0);
    });
  });
}
