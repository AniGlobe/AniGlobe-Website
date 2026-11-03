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
    { class: 'tc-genre-track', role: 'img', 'aria-label': genre.name + ': ' + genre.count + ' titles' },
    el('span', { class: 'tc-genre-fill', style: { width: percentage + '%' }, 'aria-hidden': 'true' })
  );

  return el(
    'li',
    { class: 'tc-genre' },
    el('span', { class: 'tc-genre-name' }, genre.name),
    track,
    el('span', { class: 'tc-genre-count' }, displayNumber(genre.count))
  );
}

function titleRow(entry, index) {
  return el(
    'li',
    { class: 'tc-title-row' },
    el('span', { class: 'tc-title-rank', 'aria-hidden': 'true' }, String(index + 1)),
    el('span', { class: 'tc-title-name' }, entry.title),
    el('span', { class: 'tc-title-score' }, entry.score + '/10')
  );
}

function favoriteRow(entry, index) {
  return el(
    'li',
    { class: 'tc-title-row' },
    el('span', { class: 'tc-title-rank', 'aria-hidden': 'true' }, String(index + 1)),
    el('span', { class: 'tc-title-name' }, entry.title)
  );
}

function section(title, content) {
  return el(
    'section',
    { class: 'tc-section' },
    el('h3', { class: 'tc-section-title' }, title),
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
    { class: 'tc-stats' },
    ...[
      { label: 'Titles', value: displayNumber(profile.count) },
      activity,
      time,
      { label: 'Mean score', value: displayMeanScore(profile) },
    ].map((stat) =>
      el(
        'div',
        { class: 'tc-stat' },
        el('dt', { class: 'tc-stat-label' }, stat.label),
        el('dd', { class: 'tc-stat-value' }, stat.value)
      )
    )
  );

  return el(
    'article',
    {
      class: 'taste-card',
      dataset: { theme: prefs.theme },
      'aria-label': media.label + ' Wrapped for ' + profile.name,
    },
    el(
      'header',
      { class: 'tc-head' },
      el(
        'div',
        { class: 'tc-identity' },
        profile.url
          ? el(
              'h2',
              { class: 'tc-name' },
              el('a', { href: profile.url, target: '_blank', rel: 'noopener noreferrer' }, profile.name)
            )
          : el('h2', { class: 'tc-name' }, profile.name)
      ),
      profile.memberSince
        ? el('p', { class: 'tc-since' }, profile.source + ' since ' + profile.memberSince)
        : null,
      el('span', { class: 'tc-globe', 'aria-hidden': 'true' })
    ),
    prefs.showInsight
      ? el(
          'section',
          { class: 'tc-archetype' },
          el('h3', { class: 'tc-archetype-label' }, taste.label),
          el('p', { class: 'tc-archetype-blurb' }, taste.blurb)
        )
      : null,
    stats,
    genres.length
      ? section(
          'Frequent genres',
          el('ul', { class: 'tc-genre-list' }, genres.map((genre) => genreRow(genre, genreMaximum)))
        )
      : null,
    highestRated.length
      ? section(
          'Top completed titles',
          el('ol', { class: 'tc-title-list' }, highestRated.map((entry, index) => titleRow(entry, index)))
        )
      : null,
    favorites.length
      ? section(
          'Favorite ' + media.plural,
          el(
            'ol',
            { class: 'tc-title-list' },
            favorites.map((entry, index) => favoriteRow(entry, index))
          )
        )
      : null,
    signature && prefs.showInsight
      ? section(
          'Standout rating',
          el(
            'p',
            { class: 'tc-insight' },
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
      ? el('p', { class: 'tc-footer-note' }, 'Average gap from AniList scores: ' + deviation + ' points')
      : null,
    el(
      'footer',
      { class: 'tc-footer' },
      el('span', {}, profile.source + ' profile summary'),
      el('span', { class: 'tc-footer-mark' }, 'AniGlobe')
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
