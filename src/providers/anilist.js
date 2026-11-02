/**
 * AniList provider for AniManga Wrapped.
 */

import { fetchProfile } from '../anilist.js';
import { resolveMediaType } from '../domain/media.js';

function isSafeUsername(username) {
  return /^[A-Za-z0-9_-]{2,32}$/.test(username);
}

export default {
  id: 'anilist',
  label: 'AniList',
  placeholder: 'AniList username',
  fetchProfile: (username, mediaType) => fetchProfile(username, resolveMediaType(mediaType).id),
  isSafeUsername,
};
