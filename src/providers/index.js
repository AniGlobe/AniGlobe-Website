/**
 * Data source registry shared by AniManga Wrapped.
 */

import anilist from './anilist.js';
import mal from './mal.js';

export const providers = [mal, anilist];

export function getProvider(id) {
  return providers.find((provider) => provider.id === id) || null;
}
