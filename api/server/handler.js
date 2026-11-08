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

export function createRequestHandler({ db, api }) {
  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, 'http://placeholder');
      const pathname = url.pathname;

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
