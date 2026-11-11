/**
 * Shared API request handler — used by the local dev server (dev.js) and the
 * Vercel function (api/[...path].js), so both environments run identical
 * routing:
 *
 *   /api/health        database ping + uptime
 *   /api/*             JSON account endpoints (see api.js)
 *
 * Static files are NOT served here (Vercel serves them from the project
 * root; locally dev.js serves them via static.js).
 */

import { json, HttpError, sendHttpError } from './http.js';
import { securityHeaders } from './headers.js';

export function effectivePathname(req) {
  // On Vercel the request reaches the function through a rewrite, so the
  // request URL may be the rewritten destination rather than the original
  // path. The platform passes the original path in x-matched-path; prefer it
  // whenever it looks like an API path. Locally (dev.js) req.url is already
  // the original and the header is absent, so this is a no-op there.
  const matched = req.headers && req.headers['x-matched-path'];
  if (typeof matched === 'string' && matched.startsWith('/api/')) {
    return matched.split('?')[0];
  }
  const url = new URL(req.url, 'http://placeholder');
  return url.pathname;
}

export function createRequestHandler({ db, api }) {
  return async function requestHandler(req, res) {
    try {
      const pathname = effectivePathname(req);
      // Normalize req.url so downstream route matching (and query parsing in
      // handlers) sees the original API path even after a platform rewrite.
      const url = new URL(req.url, 'http://placeholder');
      if (url.pathname !== pathname) {
        req.url = pathname + url.search;
      }

      for (const [key, value] of Object.entries(securityHeaders())) res.setHeader(key, value);

      if (pathname === '/api/health') {
        let dbOk = false;
        try {
          await db.execute('SELECT 1 AS ok');
          dbOk = true;
        } catch {
          dbOk = false;
        }
        json(res, dbOk ? 200 : 503, {
          ok: dbOk,
          uptimeSeconds: Math.floor(process.uptime()),
          db: dbOk ? 'ok' : 'down',
          // Which build is answering, so an operator can tell a stale
          // deployment from a real failure. Vercel sets this per build.
          commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        });
        return;
      }

      if (pathname.startsWith('/api/')) {
        await api.handle(req, res);
        return;
      }

      throw new HttpError(404, 'Not found.');
    } catch (error) {
      if (!res.headersSent) sendHttpError(res, error);
      else res.end();
    }
  };
}
