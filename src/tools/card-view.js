import { el } from '../lib.js';
import { resolveMediaType } from '../domain/media.js';
import { contrarianIndex, signatureTitle, tasteProfile } from '../domain/profile-insights.js';

const SECTION_ORDER = [
  'stats',
  'status',
  'insight',
  'genres',
  'formats',
  'years',
  'distribution',
  'scored',
  'favorites',
];

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

function section(title, content, note, id) {
  return el(
    'section',
    { class: 'export-section', dataset: id ? { section: id } : {} },
    el('h3', { class: 'export-section-title' }, title),
    content,
    note ? el('p', { class: 'export-section-note' }, note) : null
  );
}

function statusLabel(mediaType, status) {
  const labels = mediaType === 'manga'
    ? { reading: 'Reading', completed: 'Completed', onHold: 'On hold', dropped: 'Dropped', planToRead: 'Plan to read' }
    : { watching: 'Watching', completed: 'Completed', onHold: 'On hold', dropped: 'Dropped', planToWatch: 'Plan to watch' };
  return labels[status] || status;
}

function statusSection(profile) {
  const statuses = profile.statusCounts && Object.entries(profile.statusCounts)
    .map(([status, count]) => ({ status, count }))
    .filter((entry) => entry.count > 0);
  if (!statuses || !statuses.length) return null;

  const total = statuses.reduce((sum, entry) => sum + entry.count, 0);
  return section(
    'List progress',
    el(
      'ul',
      { class: 'export-status-list' },
      statuses.map((entry) => {
        const percentage = total > 0 ? Math.round((entry.count / total) * 100) : 0;
        const fill = el('span', {
          class: 'export-status-fill',
          style: { width: Math.round((entry.count / total) * 100) + '%' },
          'aria-hidden': 'true',
        });
        return el(
          'li',
          { class: 'export-status-row' },
          el('span', { class: 'export-status-label' }, statusLabel(profile.mediaType, entry.status)),
          el('span', { class: 'export-status-track', role: 'img', 'aria-label': percentage + '% of listed titles' }, fill),
          el('span', { class: 'export-status-count num' }, displayNumber(entry.count))
        );
      })
    ),
    total.toLocaleString() + ' listed titles',
    'status'
  );
}

function distributionSection(distribution, source) {
  if (!Array.isArray(distribution) || !distribution.length) return null;
  const maximum = Math.max(...distribution.map((entry) => entry.count));
  const scoreScale = source === 'MyAnimeList' ? 10 : 100;
  return section(
    'Your ratings',
    el(
      'ul',
      { class: 'export-score-list' },
      distribution.map((entry) => {
        const percentage = maximum > 0 ? Math.round((entry.count / maximum) * 100) : 0;
        return el(
          'li',
          { class: 'export-score-row' },
          el('span', { class: 'export-score-label num' }, entry.score + '/' + scoreScale),
          el(
            'span',
            { class: 'export-score-track', role: 'img', 'aria-label': entry.count + ' titles rated ' + entry.score + ' out of ' + scoreScale },
            el('span', { class: 'export-score-fill', style: { width: percentage + '%' }, 'aria-hidden': 'true' })
          ),
          el('span', { class: 'export-score-count num' }, displayNumber(entry.count))
        );
      })
    ),
    null,
    'distribution'
  );
}

function metadataSection(entries, title, source, profile, id, formatter) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const rows = entries.slice(0, 6);
  const list = el(
    'ul',
    { class: 'export-metadata-list' },
    rows.map((entry) =>
      el(
        'li',
        { class: 'export-metadata-row' },
        el('span', { class: 'export-metadata-name' }, formatter(entry)),
        el('span', { class: 'export-metadata-count num' }, displayNumber(entry.count))
      )
    )
  );
  const note = source === 'MyAnimeList' && profile.genresSampled
    ? 'Details for ' + displayNumber(profile.genreSampleSize) + ' of ' +
      displayNumber(profile.genrePopulationSize) + ' listed titles'
    : null;
  return section(title, list, note, id);
}

function cardOptions(options) {
  const value = options || {};
  const order = Array.isArray(value.order) ? value.order : [];
  const normalizedOrder = [
    ...new Set([...order.filter((id) => SECTION_ORDER.includes(id)), ...SECTION_ORDER]),
  ];
  return {
    theme: ['atlas', 'coast', 'night'].includes(value.theme) ? value.theme : 'atlas',
    layout: value.layout === 'story' ? 'story' : 'square',
    order: normalizedOrder,
    showStats: value.showStats !== false,
    showStatus: value.showStatus !== false,
    showGenres: value.showGenres !== false,
    showFormats: value.showFormats !== false,
    showYears: value.showYears !== false,
    showFavorites: value.showFavorites !== false,
    showScored: value.showScored !== false,
    showDistribution: value.showDistribution !== false,
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
  const formats = prefs.showFormats ? profile.formats : [];
  const years = prefs.showYears ? profile.years : [];
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
    { class: 'export-stats', dataset: { section: 'stats' } },
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

  const sections = {
    stats: prefs.showStats ? stats : null,
    status: prefs.showStatus ? statusSection(profile) : null,
    insight: prefs.showInsight
      ? el(
          'div',
          { class: 'export-insight-group', dataset: { section: 'insight' } },
          el(
            'div',
            { class: 'export-archetype' },
            el('h3', { class: 'export-archetype-label' }, taste.label),
            el('p', { class: 'export-archetype-blurb' }, taste.blurb)
          ),
          signature
            ? section(
                'Standout rating',
                el(
                  'p',
                  { class: 'export-insight' },
                  signature.title,
                  signatureGap === 0
                    ? ' is rated in line with its ' + profile.source + ' average.'
                    : ' is rated ' +
                      Math.abs(signatureGap) +
                      ' points ' +
                      (signatureGap > 0 ? 'above' : 'below') +
                      ' its ' + profile.source + ' average.'
                )
              )
            : null,
          deviation !== null
            ? el(
                'p',
                { class: 'export-footer-note' },
                'Average gap from ' + profile.source + ' scores in the title sample: ' + deviation + ' points'
              )
            : null
        )
      : null,
    genres: genres.length
      ? section(
          profile.genresSampled ? 'Genre mix in title sample' : 'Frequent genres',
          el('ul', { class: 'export-genre-list' }, genres.map((genre) => genreRow(genre, genreMaximum))),
          profile.genresSampled
            ? 'Details for ' + displayNumber(profile.genreSampleSize) + ' of ' +
              displayNumber(profile.genrePopulationSize) + ' listed titles'
            : null,
          'genres'
        )
      : null,
    formats: metadataSection(
      formats,
      profile.genresSampled ? 'Formats in title sample' : 'Formats',
      profile.source,
      profile,
      'formats',
      (entry) => entry.name
    ),
    years: metadataSection(
      years,
      profile.genresSampled ? 'Release years in title sample' : 'Release years',
      profile.source,
      profile,
      'years',
      (entry) => String(entry.year)
    ),
    distribution: prefs.showDistribution ? distributionSection(profile.distribution, profile.source) : null,
    scored: highestRated.length
      ? section(
          'Top completed titles',
          el('ol', { class: 'export-title-list' }, highestRated.map((entry, index) => titleRow(entry, index))),
          null,
          'scored'
        )
      : null,
    favorites: favorites.length
      ? section(
          'Favorite ' + media.plural,
          el('ol', { class: 'export-title-list' }, favorites.map((entry, index) => favoriteRow(entry, index))),
          null,
          'favorites'
        )
      : null,
  };

  const bodySections = prefs.order.map((id) => sections[id]).filter(Boolean);
  return el(
    'article',
    {
      class: 'export-card',
      dataset: { theme: prefs.theme, layout: prefs.layout },
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
      ...bodySections,
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
  const lines = [profile.name + ' | ' + media.label + ' Wrapped (' + profile.source + ')'];

  for (const id of prefs.order) {
    if (id === 'stats' && prefs.showStats) {
      lines.push(
        displayNumber(profile.count) + ' titles, ' + activity + ', ' + time,
        'Mean score: ' + displayMeanScore(profile)
      );
    } else if (id === 'insight' && prefs.showInsight) {
      lines.push(taste.label + ': ' + taste.blurb);
    } else if (id === 'status' && prefs.showStatus && profile.statusCounts) {
      const statusText = Object.entries(profile.statusCounts)
        .map(([status, count]) => statusLabel(profile.mediaType, status) + ': ' + displayNumber(count))
        .join(', ');
      if (statusText) lines.push('List progress: ' + statusText);
    } else if (id === 'genres' && prefs.showGenres && profile.genres.length) {
      const label = profile.genresSampled ? 'Genre sample' : 'Frequent genres';
      lines.push(label + ': ' + profile.genres.slice(0, 5).map((genre) => genre.name).join(', '));
      if (profile.genresSampled) {
        lines.push(
          'Genre details cover ' + displayNumber(profile.genreSampleSize) + ' of ' +
            displayNumber(profile.genrePopulationSize) + ' listed titles.'
        );
      }
    } else if (id === 'formats' && prefs.showFormats && profile.formats.length) {
      const label = profile.genresSampled ? 'Formats in title sample' : 'Formats';
      lines.push(label + ': ' + profile.formats.slice(0, 6).map((entry) => entry.name + ' (' + entry.count + ')').join(', '));
    } else if (id === 'years' && prefs.showYears && profile.years.length) {
      const label = profile.genresSampled ? 'Release years in title sample' : 'Release years';
      lines.push(label + ': ' + profile.years.slice(0, 6).map((entry) => entry.year + ' (' + entry.count + ')').join(', '));
    } else if (id === 'distribution' && prefs.showDistribution && profile.distribution.length) {
      const scoreScale = profile.source === 'MyAnimeList' ? 10 : 100;
      lines.push(
        'Ratings: ' + profile.distribution.map((entry) => entry.score + '/' + scoreScale + ' (' + entry.count + ')').join(', ')
      );
    } else if (id === 'favorites' && prefs.showFavorites && profile.favourites.length) {
      lines.push(
        'Favorite ' + media.plural + ': ' +
          profile.favourites.slice(0, 5).map((entry) => entry.title).join(', ')
      );
    } else if (id === 'scored' && prefs.showScored && profile.scored.length) {
      lines.push(
        'Top completed titles: ' +
          profile.scored.slice(0, 3).map((entry) => entry.title + ' (' + entry.score + '/10)').join(', ')
      );
    }
  }

  lines.push('Made with AniGlobe. Profile data from ' + profile.source + '.');
  return lines.join('\n');
}