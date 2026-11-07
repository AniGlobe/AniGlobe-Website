/**
 * AniGlobe server entry point.
 *
 * One process, two jobs:
 *   API   /api/*          JSON account endpoints (see server/api.js)
 *   Site  everything else static files from the repo root
 *
 * Configuration via environment variables:
 *   PORT            default 8080
 *   HOST            default 0.0.0.0
 *   DATABASE_URL    SQLite file path (default: <root>/data/aniglobe.db)
 *   NODE_ENV        "production" adds Secure to cookies + HSTS header
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from './db.js';
import { createRateLimiter } from './ratelimit.js';
import { createApiRouter } from './api.js';
import { json, HttpError, sendHttpError } from './http.js';

const rootDir = dirname(fileURLToPath(import.meta.url)) + '/..';
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const db = openDatabase();
const api = createApiRouter({
  db,
  registerLimiter: createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }),
  loginLimiter: createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 }),
});

function serveStatic(req, res, pathname) {
  let urlPath = pathname === '/' ? '/index.html' : pathname;
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch {
    sendHttpError(res, new HttpError(400, 'Malformed path.'));
    return;
  }
  // Blockdot/dotfile segments and the server tree itself never get served.
  const segments = urlPath.split('/').filter(Boolean);
  const BLOCKED = new Set(['server', 'tests', 'node_modules', 'data']);
  if (segments.some((s) => s.startsWith('.') || BLOCKED.has(s))) {
    sendHttpError(res, new HttpError(404, 'Not found.'));
    return;
  }
  const resolved = resolve(join(rootDir, normalize(urlPath)));
  if (!resolved.startsWith(resolve(rootDir) + '\\') && resolved !== resolve(join(rootDir, 'index.html'))) {
    sendHttpError(res, new HttpError(403, 'Outside the site root.'));
    return;
  }
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    sendHttpError(res, new HttpError(404, 'Not found.'));
    return;
  }
  const type = MIME_TYPES[extname(resolved).toLowerCase()] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    // JS/CSS get a short cache so updates ship quickly; everything else no-store.
    'Cache-Control': /\.(js|css|json)$/.test(resolved) ? 'public, max-age=300' : 'no-store',
  };
  if (IS_PRODUCTION) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  res.writeHead(200, headers);
  createReadStream(resolved).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://placeholder');
    if (url.pathname.startsWith('/api/')) {
      await api.handle(req, res);
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

if (process.env.NODE_ENV !== 'production') {
  // json import is kept for future health endpoints; referenced to avoid lint noise.
  void json;
}
