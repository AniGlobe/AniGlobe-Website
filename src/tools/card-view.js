import { el } from '../lib.js';
import { resolveMediaType } from '../domain/media.js';
import { contrarianIndex, signatureTitle, tasteProfile } from '../anilist.js';

function displayNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString()
    : 'Not listed';
}

function displayMeanScore(profile) {
  if (profile.meanScore == null || profile.meanScore <= 0) return 'Not listed';
  if (profile.source === 'MyAnimeList' && typeof profile.meanScoreRaw === 'number') {
    return profile.meanScoreRaw.toFixed(2) + '/10';
  }
  return profile.meanScore + '/100';
}

function genreRow(genre, maximum) {
  const percentage = maximum > 0
    ? Math.max(0, Math.min(100, Math.round((genre.count / maximum) * 100)))
    : 0;
  const track = el(
    'span',
    { class: 'export-genre-track', role: 'img', 'aria-label': genre.name + ': ' + genre.count + ' titles' },
    el('span', { class: 'export-genre-fill', style: { width: percentage + '%' }, 'aria-hidden': 'true' })
  );

  return el(
    'li',
    { class: 'export-genre' },
    el('span', { class: 'export-genre-name' }, genre.name),
    track,
    el('span', { class: 'export-genre-count num' }, displayNumber(genre.count))
  );
}

function titleRow(entry, index) {
  return el(
    'li',
    { class: 'export-title-row' },
    el('span', { class: 'export-title-rank', 'aria-hidden': 'true' }, String(index + 1)),
    el('span', { class: 'export-title-name' }, entry.title),
    el('span', { class: 'export-title-score num' }, entry.score + '/10')
  );
}

function favoriteRow(entry, index) {
  return el(
    'li',
    { class: 'export-title-row' },
    el('span', { class: 'export-title-rank', 'aria-hidden': 'true' }, String(index + 1)),
    el('span', { class: 'export-title-name' }, entry.title)
  );
}

function section(title, content) {
  return el(
    'section',
    { class: 'export-section' },
    el('h3', { class: 'export-section-title' }, title),
    content
  );
}

function cardOptions(options) {
  const value = options || {};
  return {
    theme: ['atlas', 'coast', 'night'].includes(value.theme) ? value.theme : 'atlas',
    showGenres: value.showGenres !== false,
    showFavorites: value.showFavorites !== false,
    showScored: value.showScored !== false,
    showInsight: value.showInsight !== false,
  };
}

function timeStat(profile, media) {
  if (profile.mediaType === 'manga') {
    return { label: media.timeLabel, value: displayNumber(profile.daysRead) };
  }
  return { label: 'Hours watched', value: displayNumber(profile.hours) };
}

function globeStamp(size = 'md') {
  const cls = 'globe-stamp';
  return el('img', {
    class: cls + (size !== 'md' ? ' ' + cls + '-' + size : ''),
    src: 'assets/logo/AniGlobe/AniGlobe - DARK GLOBE TRANSPARENT BACKGROUND.png',
    alt: '',
    'aria-hidden': 'true',
  });
}

export function renderCard(profile, options) {
  const prefs = cardOptions(options);
  const media = resolveMediaType(profile.mediaType);
  const taste = tasteProfile(profile);
  const signature = signatureTitle(profile);
  const genres = prefs.showGenres ? profile.genres.slice(0, 5) : [];
  const genreMaximum = genres.reduce((maximum, genre) => Math.max(maximum, genre.count), 0);
  const highestRated = prefs.showScored ? profile.scored.slice(0, 3) : [];
  const favorites = prefs.showFavorites ? profile.favourites.slice(0, 5) : [];
  const deviation = contrarianIndex(profile);
  const signatureGap = signature ? signature.score * 10 - signature.average : null;
  const activity = media.id === 'anime'
    ? { label: 'Episodes', value: displayNumber(profile.episodes) }
    : { label: 'Chapters', value: displayNumber(profile.chapters) };
  const time = timeStat(profile, media);

  const stats = el(
    'dl',
    { class: 'export-stats' },
    ...[
      { label: 'Titles', value: displayNumber(profile.count) },
      activity,
      time,
      { label: 'Mean score', value: displayMeanScore(profile) },
    ].map((stat) =>
      el(
        'div',
        { class: 'export-stat' },
        el('dt', { class: 'export-stat-label' }, stat.label),
        el('dd', { class: 'export-stat-value num' }, stat.value)
      )
    )
  );

  return el(
    'article',
    {
      class: 'export-card',
      dataset: { theme: prefs.theme },
      'aria-label': media.label + ' Wrapped for ' + profile.name,
    },
    el(
      'header',
      { class: 'export-card-header' },
      el('h2', { class: 'export-card-title' }, media.label + ' Wrapped'),
      globeStamp('sm')
    ),
    el(
      'div',
      { class: 'export-card-body' },
      el(
        'div',
        { class: 'export-identity' },
        el('p', { class: 'export-name' }, profile.name),
        profile.memberSince
          ? el('p', { class: 'export-since' }, profile.source + ' since ' + profile.memberSince)
          : null,
      ),
      prefs.showInsight
        ? el(
            'div',
            { class: 'export-archetype' },
            el('h3', { class: 'export-archetype-label' }, taste.label),
            el('p', { class: 'export-archetype-blurb' }, taste.blurb)
          )
        : null,
      stats,
      genres.length
        ? section(
            'Frequent genres',
            el('ul', { class: 'export-genre-list' }, genres.map((genre) => genreRow(genre, genreMaximum)))
          )
        : null,
      highestRated.length
        ? section(
            'Top completed titles',
            el('ol', { class: 'export-title-list' }, highestRated.map((entry, index) => titleRow(entry, index)))
          )
        : null,
      favorites.length
        ? section(
            'Favorite ' + media.plural,
            el(
              'ol',
              { class: 'export-title-list' },
              favorites.map((entry, index) => favoriteRow(entry, index))
            )
          )
        : null,
      signature && prefs.showInsight
        ? section(
            'Standout rating',
            el(
              'p',
              { class: 'export-insight' },
              signature.title,
              signatureGap === 0
                ? ' is rated in line with its AniList average.'
                : ' is rated ' +
                  Math.abs(signatureGap) +
                  ' points ' +
                  (signatureGap > 0 ? 'above' : 'below') +
                  ' its AniList average.'
            )
          )
        : null,
      deviation !== null && prefs.showInsight
        ? el('p', { class: 'export-footer-note' }, 'Average gap from AniList scores: ' + deviation + ' points')
        : null,
      el(
        'footer',
        { class: 'export-card-footer' },
        el('span', {}, profile.source + ' profile summary'),
        el('span', { class: 'export-footer-mark' }, 'AniGlobe')
      )
    )
  );
}

export function summaryText(profile, options) {
  const prefs = cardOptions(options);
  const media = resolveMediaType(profile.mediaType);
  const taste = tasteProfile(profile);
  const activity = media.id === 'anime'
    ? displayNumber(profile.episodes) + ' episodes'
    : displayNumber(profile.chapters) + ' chapters and ' + displayNumber(profile.volumes) + ' volumes';
  const time = media.id === 'anime'
    ? displayNumber(profile.hours) + ' hours watched'
    : displayNumber(profile.daysRead) + ' days read';
  const lines = [
    profile.name + ' | ' + media.label + ' Wrapped (' + profile.source + ')',
    displayNumber(profile.count) + ' titles, ' + activity + ', ' + time,
    'Mean score: ' + displayMeanScore(profile),
  ];

  if (prefs.showInsight) lines.push(taste.label + ': ' + taste.blurb);
  if (prefs.showGenres && profile.genres.length) {
    lines.push('Frequent genres: ' + profile.genres.slice(0, 5).map((genre) => genre.name).join(', '));
  }
  if (prefs.showFavorites && profile.favourites.length) {
    lines.push(
      'Favorite ' + media.plural + ': ' +
        profile.favourites.slice(0, 5).map((entry) => entry.title).join(', ')
    );
  }
  if (prefs.showScored && profile.scored.length) {
    lines.push(
      'Top completed titles: ' +
        profile.scored.slice(0, 3).map((entry) => entry.title + ' (' + entry.score + '/10)').join(', ')
    );
  }

  lines.push('Made with AniGlobe. Profile data from ' + profile.source + '.');
  return lines.join('\n');
}