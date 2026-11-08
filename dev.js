/**
 * Local development server: the API handler plus static file serving for
 * everything else. Production (Vercel) uses api/[...path].js instead and
 * serves static files from the platform.
 *
 * Configuration via environment variables:
 *   PORT            default 8080
 *   HOST            default 0.0.0.0
 *   DATABASE_URL    database URL (default: file:<root>/data/aniglobe.db;
 *                   use libsql://... + DATABASE_AUTH_TOKEN for Turso)
 *   NODE_ENV        "production" adds Secure to cookies + HSTS header
 */

import { createServer } from 'node:http';

import { openDatabase } from './api/_server/db.js';
import { createDbRateLimiter } from './api/_server/ratelimit.js';
import { createApiRouter } from './api/_server/api.js';
import { createRequestHandler } from './api/_server/handler.js';
import { serveStatic } from './api/_server/static.js';
import { HttpError } from './api/_server/http.js';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const db = await openDatabase();
const api = createApiRouter({
  db,
  registerLimiter: createDbRateLimiter({ db, windowMs: 15 * 60 * 1000, max: 20 }),
  loginLimiter: createDbRateLimiter({ db, windowMs: 15 * 60 * 1000, max: 30 }),
  resetLimiter: createDbRateLimiter({ db, windowMs: 60 * 60 * 1000, max: 5 }),
});
const requestHandler = createRequestHandler({ db, api });

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
    if (!res.headersSent) {
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message || 'Server error' }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AniGlobe listening at http://${HOST}:${PORT} (db: ${process.env.DATABASE_URL || '<root>/data/aniglobe.db'})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
