export const MEDIA = {
  anime: {
    id: 'anime',
    label: 'Anime',
    plural: 'anime',
    action: 'watch',
    activityLabel: 'Episodes',
    timeLabel: 'Days watched',
  },
  manga: {
    id: 'manga',
    label: 'Manga',
    plural: 'manga',
    action: 'read',
    activityLabel: 'Chapters',
    timeLabel: 'Days read',
  },
};

export function resolveMediaType(value) {
  return value === 'manga' ? MEDIA.manga : MEDIA.anime;
}
