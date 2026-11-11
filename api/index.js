/**
 * Vercel serverless entry point for /api/*.
 *
 * Builds the request handler once per instance: async Turso (or local file)
 * database via api/_server/db.js, the account API router, and the shared
 * handler. Static files are served by Vercel from the project root; every
 * /api/* request is rewritten here by vercel.json.
 */

import { openDatabase } from './_server/db.js';
import { createDbRateLimiter } from './_server/ratelimit.js';
import { createApiRouter } from './_server/api.js';
import { createRequestHandler } from './_server/handler.js';

let handlerPromise = null;

function handler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      const { db, catalogueDb } = await openDatabase();
      const api = createApiRouter({
        db,
        catalogueDb,
        registerLimiter: createDbRateLimiter({ db, windowMs: 15 * 60 * 1000, max: 20 }),
        loginLimiter: createDbRateLimiter({ db, windowMs: 15 * 60 * 1000, max: 30 }),
        resetLimiter: createDbRateLimiter({ db, windowMs: 60 * 60 * 1000, max: 5 }),
      });
      return createRequestHandler({ db, catalogueDb, api });
    })();
    handlerPromise.catch(() => {
      handlerPromise = null;
    });
  }
  return handlerPromise;
}

export default async function apiHandler(req, res) {
  try {
    const requestHandler = await handler();
    await requestHandler(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(error.status || 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service unavailable.' }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}
