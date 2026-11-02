/**
 * AniList provider for Anime Wrapped.
 */

import { fetchProfile } from '../anilist.js';

function isSafeUsername(username) {
  return /^[A-Za-z0-9_-]{2,32}$/.test(username);
}

export default {
  id: 'anilist',
  label: 'AniList',
  placeholder: 'AniList username',
  fetchProfile,
  isSafeUsername,
};
