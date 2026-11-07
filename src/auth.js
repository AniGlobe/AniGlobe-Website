/**
 * Account client: talks to the AniGlobe backend (/api/*) and keeps the
 * in-memory session state the shell renders from.
 *
 * The backend owns the session (httpOnly cookie). The page reads the CSRF
 * cookie to echo the token on mutations, and the "me" endpoint answers
 * whether someone is signed in. When the backend is unreachable (static-file
 * deployment without the node server), every call resolves anonymously —
 * the site keeps working, accounts just stay unavailable.
 */

import { store } from './lib.js';

const SESSION_KEY = 'auth:session';
const SESSION_EVENT = 'aniglobe:auth';

export function getSession() {
  return store.get(SESSION_KEY, null);
}

export function setSession(user) {
  if (user) store.set(SESSION_KEY, { user, at: Date.now() });
  else store.remove(SESSION_KEY);
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: { user } }));
}

export function onSessionChange(listener) {
  const handler = (event) => listener(event.detail && event.detail.user);
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
}

function readCsrf() {
  const match = document.cookie.match(/(?:^|;\s*)aniglobe_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function request(path, { method = 'GET', body = undefined } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCsrf();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const response = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { status: response.status, json: payload };
}

async function me() {
  const { json } = await request('/api/auth/me');
  return json && json.user ? json.user : null;
}

/** Probe once at startup so the topbar renders the right state immediately. */
export async function refreshSession() {
  try {
    const user = await me();
    setSession(user);
    return user;
  } catch {
    return getSession() && getSession().user;
  }
}

export async function register({ username, email, password }) {
  const { status, json } = await request('/api/auth/register', {
    method: 'POST',
    body: { username, email, password },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not create the account.', json && json.details);
  setSession(json.user);
  return json.user;
}

export async function login({ identifier, password }) {
  const { status, json } = await request('/api/auth/login', {
    method: 'POST',
    body: { identifier, password },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not log in.', json && json.details);
  setSession(json.user);
  return json.user;
}

export async function logout() {
  try {
    await request('/api/auth/logout', { method: 'POST', body: {} });
  } finally {
    setSession(null);
  }
}

export async function changePassword(currentPassword, newPassword) {
  const { status, json } = await request('/api/auth/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not change the password.', json && json.details);
}

export async function deleteAccount(password) {
  const { status, json } = await request('/api/auth/account', {
    method: 'DELETE',
    body: { password },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not delete the account.', json && json.details);
  setSession(null);
}

export class AuthError extends Error {
  constructor(message, details = null) {
    super(message);
    this.details = details;
    this.field = details && details.field ? details.field : null;
    this.fields = details && details.fields ? details.fields : null;
  }
}

/* ------------------------------------------------------------------ sync */

export async function pushWrappedPrefs(prefs) {
  if (!getSession()) return false;
  try {
    const { status } = await request('/api/sync/wrapped-prefs', { method: 'POST', body: { prefs } });
    return status === 200;
  } catch {
    return false;
  }
}

export async function pullWrappedPrefs() {
  if (!getSession()) return null;
  try {
    const { status, json } = await request('/api/sync/wrapped-prefs');
    return status === 200 && json ? json.prefs : null;
  } catch {
    return null;
  }
}

export async function pushTemplate(name, payload) {
  if (!getSession()) return false;
  try {
    const { status } = await request('/api/sync/templates', { method: 'POST', body: { name, payload } });
    return status === 200;
  } catch {
    return false;
  }
}

export async function pullTemplates() {
  if (!getSession()) return [];
  try {
    const { status, json } = await request('/api/sync/templates');
    return status === 200 && json && Array.isArray(json.templates) ? json.templates : [];
  } catch {
    return [];
  }
}

export async function deleteRemoteTemplate(name) {
  if (!getSession()) return false;
  try {
    const { status } = await request('/api/sync/templates/' + encodeURIComponent(name), { method: 'DELETE' });
    return status === 200;
  } catch {
    return false;
  }
}

export async function pushGuessProgress(entry) {
  if (!getSession()) return false;
  try {
    const { status } = await request('/api/sync/guess', { method: 'POST', body: entry });
    return status === 200;
  } catch {
    return false;
  }
}

export async function pullGuessProgress(mediaType) {
  if (!getSession()) return [];
  try {
    const path = '/api/sync/guess' + (mediaType ? '?media=' + encodeURIComponent(mediaType) : '');
    const { status, json } = await request(path);
    return status === 200 && json && Array.isArray(json.progress) ? json.progress : [];
  } catch {
    return [];
  }
}
