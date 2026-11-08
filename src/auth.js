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

export async function getProfile() {
  if (!getSession()) return null;
  const { status, json } = await request('/api/auth/profile');
  return status === 200 && json && json.profile ? json.profile : null;
}

export async function updateProfile({ bio, avatar }) {
  const { status, json } = await request('/api/auth/profile', {
    method: 'PUT',
    body: { bio, avatar },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not save your profile.', json && json.details);
  return json.profile;
}

export async function getPublicProfile(username) {
  const { status, json } = await request('/api/profile/' + encodeURIComponent(username));
  if (status === 404) return null;
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not load that profile.', json && json.details);
  return json.profile;
}

export async function requestPasswordReset(email) {
  const { status, json } = await request('/api/auth/password-reset/request', {
    method: 'POST',
    body: { email },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not request a reset.', json && json.details);
  return true;
}

export async function confirmPasswordReset(token, newPassword) {
  const { status, json } = await request('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: { token, newPassword },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not reset the password.', json && json.details);
  return true;
}

export async function confirmVerification(token) {
  const { status, json } = await request('/api/auth/verify/confirm', {
    method: 'POST',
    body: { token },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not confirm the email.', json && json.details);
  return true;
}

export async function resendVerification() {
  const { status, json } = await request('/api/auth/verify/resend', { method: 'POST', body: {} });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not resend the email.', json && json.details);
  return true;
}

export async function listSessions() {
  if (!getSession()) return [];
  const { status, json } = await request('/api/auth/sessions');
  return status === 200 && json && Array.isArray(json.sessions) ? json.sessions : [];
}

export async function revokeSession(id) {
  const { status, json } = await request('/api/auth/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not revoke that session.', json && json.details);
}

export async function revokeAllSessions() {
  const { status, json } = await request('/api/auth/sessions/revoke-all', { method: 'POST', body: {} });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not sign out everywhere.', json && json.details);
  setSession(null);
}

export async function exportData() {
  const session = getSession();
  if (!session) throw new AuthError('You need to log in first.');
  const csrf = readCsrf();
  const headers = {};
  if (csrf) headers['x-csrf-token'] = csrf;
  const response = await fetch('/api/auth/export', { headers, credentials: 'same-origin' });
  const json = await response.json().catch(() => null);
  if (response.status >= 400) throw new AuthError((json && json.error) || 'Could not export your data.', json && json.details);
  const username = String((session.user && session.user.username) || 'account').toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `aniglobe-export-${username}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

export async function setTemplatePublic(name, isPublic) {
  const { status, json } = await request('/api/sync/templates/' + encodeURIComponent(name), {
    method: 'PUT',
    body: { isPublic },
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not update that template.', json && json.details);
  return true;
}

export async function listPublicTemplates() {
  try {
    const { status, json } = await request('/api/templates/public');
    return status === 200 && json && Array.isArray(json.templates) ? json.templates : [];
  } catch {
    return [];
  }
}

export async function usePublicTemplate(id) {
  const { status, json } = await request('/api/templates/public/' + encodeURIComponent(id) + '/use', {
    method: 'POST',
    body: {},
  });
  if (status >= 400) throw new AuthError((json && json.error) || 'Could not add that template.', json && json.details);
  return json;
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
