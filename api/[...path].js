/**
 * Vercel serverless entry point (catch-all for /api/*).
 *
 * Builds the request handler once per instance: async Turso (or local file)
 * database via api/server/db.js, the account API router, and the shared
 * handler. Static files are served by Vercel from the project root, so this
 * function only ever sees /api/* requests (see vercel.json).
 */

import { openDatabase } from './server/db.js';
import { createDbRateLimiter } from './server/ratelimit.js';
import { createApiRouter } from './server/api.js';
import { createRequestHandler } from './server/handler.js';

let handlerPromise = null;

function handler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      const db = await openDatabase();
      const api = createApiRouter({
        db,
        registerLimiter: createDbRateLimiter({ db, windowMs: 15 * 60 * 1000, max: 20 }),
        loginLimiter: createDbRateLimiter({ db, windowMs: 15 * 60 * 1000, max: 30 }),
        resetLimiter: createDbRateLimiter({ db, windowMs: 60 * 60 * 1000, max: 5 }),
      });
      return createRequestHandler({ db, api });
    })();
  }
  return handlerPromise;
}

export default async function apiHandler(req, res) {
  const requestHandler = await handler();
  await requestHandler(req, res);
}
