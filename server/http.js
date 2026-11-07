/**
 * Tiny HTTP helpers shared by the API: body parsing, cookies, CSRF, errors.
 * Pure functions where possible so they are unit-testable without a server.
 */

import { randomBytes, createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

const COOKIE_NAME = 'aniglobe_session';

/**
 * Read a JSON request body with a hard size cap. Rejects oversized bodies so
 * a huge payload cannot exhaust memory before validation.
 */
export function readJsonBody(req, { limitBytes = 256 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new HttpError(413, 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        resolve({});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON.'));
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        reject(new HttpError(400, 'Request body must be a JSON object.'));
        return;
      }
      resolve(parsed);
    });
    req.on('error', (error) => reject(error instanceof HttpError ? error : new HttpError(400, 'Request body could not be read.')));
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && !(name in cookies)) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
    }
  }
  return cookies;
}

export function sessionCookie(token, { secure = false, maxAgeSeconds } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie({ secure = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function getSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || null;
}

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'aniglobe_csrf';

/**
 * Double-submit CSRF: the API sets an unsigned random cookie on login
 * (readable by the page) and the client echoes it in the X-CSRF-Token header
 * on every mutation. The server compares the two halves — no secret needed,
 * this blocks cross-site request forgery.
 */
export function csrfToken() {
  return randomToken(24);
}

export function csrfCookie(token, { secure = false, maxAgeSeconds = 30 * 24 * 60 * 60 } = {}) {
  const parts = [
    `${CSRF_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function requireCsrf(req) {
  const cookies = parseCookies(req);
  const cookieValue = cookies[CSRF_COOKIE];
  const headerValue = req.headers[CSRF_HEADER];
  if (!cookieValue || !headerValue || cookieValue !== headerValue) {
    throw new HttpError(403, 'Missing or invalid CSRF token.');
  }
}

export function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendHttpError(res, error) {
  if (error instanceof HttpError) {
    json(res, error.status, {
      error: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }
  json(res, 500, { error: 'Something went wrong on our side. Try again in a moment.' });
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket ? req.socket.remoteAddress || 'unknown' : 'unknown';
}

/**
 * Cheap, honest input checks. The messages are the same ones a human would
 * write; every failure names the field so the form can point at it.
 */
export function validateUsername(value) {
  const username = String(value == null ? '' : value).trim();
  if (!username) return { error: 'Enter a username.' };
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return { error: 'Usernames can use letters, numbers, dots, dashes, and underscores (3–32 characters).' };
  }
  return { value: username };
}

export function validateEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  if (!email) return { error: 'Enter an email address.' };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { error: 'That does not look like a valid email address.' };
  }
  return { value: email };
}

export function validatePassword(value) {
  const password = String(value == null ? '' : value);
  if (!password) return { error: 'Enter a password.' };
  if (password.length < 10) return { error: 'Passwords need at least 10 characters.' };
  if (password.length > 128) return { error: 'Passwords can be at most 128 characters.' };
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    return { error: 'Use a mix of letters, numbers, and symbols.' };
  }
  return { value: password };
}
