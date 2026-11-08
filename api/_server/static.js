/**
 * Static file serving for local development (dev.js). On Vercel this is
 * unnecessary — the platform serves project-root files directly and the
 * function only receives /api/* requests — but the blocklist and caching
 * rules stay here so local behaviour matches production intent.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HttpError, sendHttpError } from './http.js';
import { securityHeaders } from './headers.js';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

export function serveStatic(req, res, pathname) {
  let urlPath = pathname === '/' ? '/index.html' : pathname;
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch {
    sendHttpError(res, new HttpError(400, 'Malformed path.'));
    return;
  }
  // Block dotfiles, the server tree, tests, node_modules and the database
  // itself. The single exception is .well-known/security.txt.
  if (urlPath === '/.well-known/security.txt') {
    urlPath = '/security.txt';
  }
  const segments = urlPath.split('/').filter(Boolean);
  const BLOCKED = new Set(['api', 'server', 'tests', 'node_modules', 'data']);
  if (segments.some((s) => s.startsWith('.') || BLOCKED.has(s))) {
    sendHttpError(res, new HttpError(404, 'Not found.'));
    return;
  }
  const rootResolved = resolve(rootDir);
  const resolved = resolve(join(rootResolved, normalize(urlPath)));
  if (
    resolved !== rootResolved &&
    !resolved.startsWith(rootResolved + sep) &&
    resolved !== resolve(join(rootResolved, 'index.html'))
  ) {
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
    // JS/CSS get a short cache so updates ship quickly; everything else no-store.
    'Cache-Control': /\.(js|css|json)$/.test(resolved) ? 'public, max-age=300' : 'no-store',
    ...securityHeaders(),
  };
  res.writeHead(200, headers);
  createReadStream(resolved).pipe(res);
}
