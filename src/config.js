export const site = {
  name: 'AniGlobe',
  tagline: 'A little more world for your watchlist.',
  support: '',
};

export const runtime = {
  anilistEndpoint: 'https://graphql.anilist.co',
  jikanEndpoint: 'https://jikan.lucashdo.com/v1',
  storagePrefix: 'aniglobe:',
  dataBase: '../data/',
  htmlToImageUrl: 'https://unpkg.com/html-to-image@1.11.11/dist/html-to-image.js',
  htmlToImageGlobal: 'htmlToImage',
};

export const TOOL_CATEGORIES = [
  { id: 'create', label: 'Create' },
  { id: 'play', label: 'Play' },
];

export const tools = [
  { id: 'card', label: 'AniManga Wrapped', category: 'create', load: () => import('./tools/card.js') },
  { id: 'library', label: 'Template Library', category: 'create', load: () => import('./tools/library.js') },
  { id: 'daily', label: 'Anime Guess', category: 'play', mediaType: 'anime', load: () => import('./tools/daily.js') },
  { id: 'manga-daily', label: 'Manga Guess', category: 'play', mediaType: 'manga', load: () => import('./tools/daily.js') },
  { id: 'account', label: 'Account', hidden: true, category: 'account', load: () => import('./tools/account.js') },
];

export const defaultToolId = 'card';

export function resolveToolId(hash) {
  const raw = String(hash == null ? '' : hash);
  const trimmed = raw.charAt(0) === `#` ? raw.slice(1) : raw;
  const path = trimmed.charAt(0) === `/` ? trimmed.slice(1) : trimmed;
  const id = path.split(`?`)[0].split(`/`)[0].trim();
  if (!id) return defaultToolId;
  return tools.some((tool) => tool.id === id) ? id : defaultToolId;
}
