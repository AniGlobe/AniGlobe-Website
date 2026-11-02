export const site = {
  name: 'AniCard',
  mark: 'A',
  year: 2026,
  tagline: 'Two small tools for anime lists.',
  support: '',
};

export const runtime = {
  anilistEndpoint: 'https://graphql.anilist.co',
  jikanEndpoint: 'https://api.jikan.moe/v4',
  storagePrefix: 'anicard:',
  dataBase: '../data/',
  htmlToImageUrl: 'https://unpkg.com/html-to-image@1.11.11/dist/html-to-image.js',
  htmlToImageGlobal: 'htmlToImage',
};

export const tools = [
  { id: 'card', label: 'Anime Wrapped', load: () => import('./tools/card.js') },
  { id: 'daily', label: 'Anime Guess', load: () => import('./tools/daily.js') },
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
