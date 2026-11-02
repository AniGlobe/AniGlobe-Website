/**
 * Rendering for the Anime Wrapped card.
 *
 * This module only turns profile data into DOM. It does not fetch or persist
 * anything, so the card can be reviewed and copied without extra requests.
 */

import { el } from '../lib.js';
import { contrarianIndex, signatureTitle, tasteProfile } from '../anilist.js';

function displayNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString()
    : 'Not listed';
}

function displayMeanScore(profile) {
  if (profile.meanScore === null) return 'Not listed';
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

export function renderCard(profile) {
  const taste = tasteProfile(profile);
  const signature = signatureTitle(profile);
  const genres = profile.genres.slice(0, 5);
  const genreMaximum = genres.reduce((maximum, genre) => Math.max(maximum, genre.count), 0);
  const highestRated = profile.scored.slice(0, 3);
  const deviation = contrarianIndex(profile);
  const signatureGap = signature ? signature.score * 10 - signature.average : null;

  const stats = el(
    'dl',
    { class: 'tc-stats' },
    el(
      'div',
      {},
      el('dt', { class: 'tc-stat-label' }, 'Titles'),
      el('dd', { class: 'tc-stat-value' }, displayNumber(profile.count))
    ),
    el(
      'div',
      {},
      el('dt', { class: 'tc-stat-label' }, 'Hours'),
      el('dd', { class: 'tc-stat-value' }, displayNumber(profile.hours))
    ),
    el(
      'div',
      {},
      el('dt', { class: 'tc-stat-label' }, 'Mean score'),
      el('dd', { class: 'tc-stat-value' }, displayMeanScore(profile))
    )
  );

  return el(
    'article',
    { class: 'taste-card', 'aria-label': 'Anime Wrapped for ' + profile.name },
    el(
      'header',
      { class: 'tc-head' },
      el('h2', { class: 'tc-name' }, profile.name),
      profile.memberSince
        ? el(
            'p',
            { class: 'tc-since' },
            profile.source + ' since ' + profile.memberSince
          )
        : null
    ),
    el(
      'section',
      { class: 'tc-archetype' },
      el('h3', { class: 'tc-archetype-label' }, taste.label),
      el('p', { class: 'tc-archetype-blurb' }, taste.blurb)
    ),
    stats,
    genres.length
      ? section(
          'Genres you watch',
          el('ul', { class: 'tc-genre-list' }, genres.map((genre) => genreRow(genre, genreMaximum)))
        )
      : null,
    highestRated.length
      ? section(
          'Highest-rated completed titles',
          el('ol', { class: 'tc-title-list' }, highestRated.map((entry, index) => titleRow(entry, index)))
        )
      : null,
    profile.favourites.length
      ? section(
          profile.source === 'AniList' ? 'AniList favourites' : 'MyAnimeList favorites',
          el(
            'ol',
            { class: 'tc-title-list' },
            profile.favourites.slice(0, 5).map((entry, index) => favoriteRow(entry, index))
          )
        )
      : null,
    profile.source === 'MyAnimeList' && !profile.favoritesAvailable
      ? el('p', { class: 'tc-footer-note' }, 'Favorites are not available for this public profile.')
      : null,
    signature
      ? section(
          'Your standout',
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
    deviation !== null
      ? el('p', { class: 'tc-footer-note' }, 'Average gap from AniList scores: ' + deviation + ' points')
      : null,
    el(
      'footer',
      { class: 'tc-footer' },
      el('span', {}, profile.source.toUpperCase() + ' PROFILE SUMMARY'),
      el('span', { class: 'tc-footer-mark' }, 'AniCard')
    )
  );
}

export function summaryText(profile) {
  const taste = tasteProfile(profile);
  const lines = [
    profile.name + ' | Anime Wrapped (' + profile.source + ')',
    taste.label + ': ' + taste.blurb,
    displayNumber(profile.count) + ' titles | ' + displayNumber(profile.hours) + ' hours watched',
    'Mean score: ' + displayMeanScore(profile),
  ];

  if (profile.genres.length) {
    lines.push('Top genres: ' + profile.genres.slice(0, 5).map((genre) => genre.name).join(', '));
  }

  if (profile.favourites.length) {
    lines.push(
      (profile.source === 'AniList' ? 'AniList favourites: ' : 'MyAnimeList favorites: ') +
        profile.favourites.slice(0, 5).map((entry) => entry.title).join(', ')
    );
  } else if (profile.source === 'MyAnimeList' && !profile.favoritesAvailable) {
    lines.push('MyAnimeList favorites are not available for this public profile.');
  }

  const standout = signatureTitle(profile);
  if (standout) {
    const gap = standout.score * 10 - standout.average;
    lines.push(
      standout.title +
        (gap === 0
          ? ' is rated in line with its AniList average.'
          : ' is rated ' +
            Math.abs(gap) +
            ' points ' +
            (gap > 0 ? 'above' : 'below') +
            ' its AniList average.')
    );
  }

  lines.push('Made with AniCard. Profile data from ' + profile.source + '.');
  return lines.join('\n');
}
