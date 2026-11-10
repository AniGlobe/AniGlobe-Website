/**
 * Account-side client for the catalogue and the user's library.
 * Signed-in users hit the server; guests keep entries in localStorage.
 */

import { store } from './lib.js';
import { getSession } from './auth.js';

const GUEST_KEY = 'library:entries';

export const LIBRARY_STATUSES = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];

/** How many entries the list asks for at a time. */
export const LIBRARY_PAGE_SIZE = 50;

export const STATUS_LABELS = {
  CURRENT: 'Watching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  DROPPED: 'Dropped',
  PAUSED: 'Paused',
  REPEATING: 'Rewatching',
};

function readCsrf() {
  const match = document.cookie.match(/(?:^|;\s*)aniglobe_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCsrf();
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = new Error((json && json.error) || 'The request failed.');
    error.status = response.status;
    error.details = json && json.details;
    throw error;
  }
  return json;
}

/* --------------------------------------------------------------- catalogue */

export async function searchCatalogue(query, { limit = 24 } = {}) {
  const payload = await request('/api/media/search?q=' + encodeURIComponent(query) + '&limit=' + encodeURIComponent(limit));
  return (payload && payload.results) || [];
}

export async function getMedia(id) {
  const payload = await request('/api/media/' + encodeURIComponent(id));
  return payload && payload.media;
}

/* ----------------------------------------------------------------- library */

function guestEntries() {
  const stored = store.get(GUEST_KEY, []);
  if (!Array.isArray(stored)) return [];
  // One entry per title: older saves could hold duplicates, so collapse them
  // and keep the most recently updated copy.
  const byMedia = new Map();
  for (const entry of stored) {
    if (!entry || entry.mediaId == null) continue;
    const existing = byMedia.get(entry.mediaId);
    if (!existing || String(entry.updatedAt || '') > String(existing.updatedAt || '')) {
      byMedia.set(entry.mediaId, entry);
    }
  }
  return [...byMedia.values()];
}

function saveGuestEntries(entries) {
  store.set(GUEST_KEY, entries);
}

function guestStats(entries) {
  const byStatus = {};
  const genreCounts = new Map();
  const byYear = new Map();
  for (const entry of entries) {
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    for (const genre of entry.genres || []) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
    if (entry.year) byYear.set(entry.year, (byYear.get(entry.year) || 0) + 1);
  }
  const total = entries.length;
  return {
    total,
    byStatus,
    topGenres: [...genreCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
    byYear: [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, count]) => ({ year, count })),
    completed: byStatus.COMPLETED || 0,
    watching: byStatus.CURRENT || 0,
    planned: byStatus.PLANNING || 0,
  };
}

/**
 * The list view the server applies for signed-in users: filter by status,
 * then sort. Guests get the same treatment in the browser, so both modes
 * show the same order.
 */
export function viewLibrary(entries, { status = '', sort = 'updated' } = {}) {
  const filtered = status ? entries.filter((entry) => entry.status === status) : entries.slice();
  const sorted = filtered.slice();
  if (sort === 'title') sorted.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  else if (sort === 'status') sorted.sort((a, b) => String(a.status).localeCompare(String(b.status)));
  else if (sort === 'score') sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
  else if (sort === 'year') sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
  else sorted.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return sorted;
}

export async function listLibrary({ limit = LIBRARY_PAGE_SIZE, offset = 0, status = '', sort = 'updated' } = {}) {
  if (!getSession()) {
    const entries = guestEntries();
    // Self-heal storage if older saves held duplicates.
    const stored = store.get(GUEST_KEY, []);
    if (Array.isArray(stored) && stored.length !== entries.length) saveGuestEntries(entries);
    const view = viewLibrary(entries, { status, sort });
    const page = limit == null ? view : view.slice(offset, offset + limit);
    return { entries: page, stats: guestStats(entries), guest: true, total: view.length, limit, offset };
  }
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset), sort });
  if (status) query.set('status', status);
  const payload = await request('/api/library?' + query.toString());
  const entries = (payload && payload.entries) || [];
  return {
    entries,
    stats: (payload && payload.stats) || null,
    guest: false,
    total: payload && payload.total != null ? payload.total : entries.length,
    limit: payload && payload.limit != null ? payload.limit : limit,
    offset: payload && payload.offset != null ? payload.offset : offset,
  };
}

export async function saveEntry(entry, paging = {}) {
  if (!getSession()) {
    const entries = guestEntries();
    // A catalogue result carries `id`; a stored entry carries `mediaId`.
    const lookupId = entry.mediaId != null
      ? entry.mediaId
      : (entry.media && entry.media.id != null ? entry.media.id : null);
    const existingIndex = lookupId != null
      ? entries.findIndex((item) => item.mediaId === lookupId)
      : -1;
    const existing = existingIndex >= 0 ? entries[existingIndex] : null;
    const media = entry.media || existing;
    const mediaId = media && media.id != null ? media.id : media && media.mediaId;
    if (mediaId == null) throw new Error('Pick a title first.');
    const record = {
      mediaId,
      title: media.title,
      titleRomaji: media.titleRomaji || null,
      coverUrl: media.coverUrl || null,
      format: media.format || null,
      episodes: media.episodes != null ? media.episodes : null,
      chapters: media.chapters != null ? media.chapters : null,
      volumes: media.volumes != null ? media.volumes : null,
      year: media.year != null ? media.year : null,
      averageRating: media.averageRating != null ? media.averageRating : null,
      genres: media.genres || [],
      status: entry.status || 'PLANNING',
      progress: Number(entry.progress || 0),
      score: entry.score == null ? null : entry.score,
      notes: entry.notes || null,
      favourite: entry.favourite === true,
      updatedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, record);
    else entries.unshift(record);
    saveGuestEntries(entries);
    return listLibrary(paging);
  }
  const body = {
    mediaId: entry.mediaId,
    status: entry.status,
    progress: entry.progress,
    score: entry.score,
    notes: entry.notes,
    favourite: entry.favourite === true,
  };
  if (entry.id) {
    await request('/api/library/' + encodeURIComponent(entry.id), { method: 'PUT', body });
  } else {
    await request('/api/library', { method: 'POST', body });
  }
  return listLibrary(paging);
}

export async function removeEntry(entry, paging = {}) {
  const id = entry && typeof entry === 'object' ? entry.id : entry;
  const mediaId = entry && typeof entry === 'object' ? entry.mediaId : entry;
  if (!getSession()) {
    const entries = guestEntries().filter((item) => item.mediaId !== mediaId);
    saveGuestEntries(entries);
    return listLibrary(paging);
  }
  await request('/api/library/' + encodeURIComponent(id), { method: 'DELETE' });
  return listLibrary(paging);
}

export async function exportLibrary(format = 'json') {
  if (!getSession()) {
    const entries = guestEntries();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aniglobe-library.json';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  }
  const response = await fetch('/api/library/export?format=' + encodeURIComponent(format), { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not export your library.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'aniglobe-library.' + (format === 'csv' ? 'csv' : 'json');
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
