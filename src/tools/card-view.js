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
    el('span', { class: 'export-genre-fill' + (genre.count === maximum ? ' is-max' : ''), style: { width: percentage + '%' }, 'aria-hidden': 'true' })
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
    el(
      'div',
      { class: 'export-section-head' },
      el('h3', { class: 'export-section-title' }, title),
      note ? el('p', { class: 'export-section-note' }, note) : null
    ),
    content
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
  const maxCount = statuses.reduce((most, entry) => Math.max(most, entry.count), 0);
  return section(
    'List progress',
    el(
      'ul',
      { class: 'export-status-list' },
      statuses.map((entry) => {
        const percentage = total > 0 ? Math.round((entry.count / total) * 100) : 0;
        const fill = el('span', {
          class: 'export-status-fill' + (entry.count === maxCount ? ' is-max' : ''),
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
            el('span', { class: 'export-score-fill' + (entry.count === maximum ? ' is-max' : ''), style: { width: percentage + '%' }, 'aria-hidden': 'true' })
          ),
          el('span', { class: 'export-score-count num' }, displayNumber(entry.count))
        );
      })
    ),
    null,
    'distribution'
  );
}

function sampleNote(source, profile) {
  return source === 'MyAnimeList' && profile.genresSampled
    ? 'Details for ' + displayNumber(profile.genreSampleSize) + ' of ' +
      displayNumber(profile.genrePopulationSize) + ' listed titles'
    : null;
}

/* Release years as a vertical bar strip: dense, honest, and it varies the
   row rhythm the horizontal charts already set */
function yearsSection(years, source, profile) {
  if (!Array.isArray(years) || !years.length) return null;
  const rows = years.slice(0, 6);
  const maximum = rows.reduce((most, entry) => Math.max(most, entry.count), 0);
  const title = profile.genresSampled ? 'Release years in title sample' : 'Release years';
  const strip = el(
    'div',
    {
      class: 'export-year-strip',
      role: 'img',
      'aria-label': rows.map((entry) => entry.year + ': ' + entry.count + ' titles').join(', '),
    },
    rows.map((entry) => {
      const height = maximum > 0 ? Math.max(6, Math.round((entry.count / maximum) * 100)) : 6;
      return el(
        'div',
        { class: 'export-year-col', 'aria-hidden': 'true' },
        el('span', { class: 'export-year-num num' }, displayNumber(entry.count)),
        el(
          'span',
          { class: 'export-year-col-track' },
          el('span', {
            class: 'export-year-col-bar' + (entry.count === maximum ? ' is-max' : ''),
            style: { height: height + '%' },
          })
        ),
        el('span', { class: 'export-year-label num' }, String(entry.year))
      );
    })
  );
  return section(title, strip, sampleNote(source, profile), 'years');
}

/* Formats as a proportional strip: TV 14 against Movie 1 and OVA 1 reads
   in two seconds, which two full-width rows never did */
function formatsSection(formats, source, profile) {
  if (!Array.isArray(formats) || !formats.length) return null;
  const rows = [...formats].sort((a, b) => b.count - a.count).slice(0, 4);
  const title = profile.genresSampled ? 'Formats in title sample' : 'Formats';
  const bar = el(
    'div',
    {
      class: 'export-format-bar',
      role: 'img',
      'aria-label': rows.map((entry) => entry.name + ': ' + entry.count + ' titles').join(', '),
    },
    rows.map((entry) =>
      el('span', { class: 'export-format-seg', style: { flex: String(Math.max(entry.count, 0.4)) }, 'aria-hidden': 'true' })
    )
  );
  const legend = el(
    'ul',
    { class: 'export-format-legend' },
    rows.map((entry) =>
      el('li', {}, entry.name, el('b', { class: 'num' }, displayNumber(entry.count)))
    )
  );
  return section(title, el('div', { class: 'export-format-mix' }, bar, legend), sampleNote(source, profile), 'formats');
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/* Theme backgrounds mirrored for one narrow job: deriving a dimmed bar tone
   when the listener overrides the accent. Keep in sync with the export CSS. */
const THEME_BACKGROUND = {
  atlas: '#f4f8fd',
  coast: '#e9f0fa',
  sakura: '#fdf0ea',
  ukiyo: '#121a2e',
  night: '#10151d',
  ember: '#181009',
};

const COLOR_KEYS = ['bg', 'soft', 'ink', 'muted', 'bars', 'signal', 'globe'];

export function sanitizeCardColors(value) {
  const source = value && typeof value === 'object' ? value : {};
  const colors = {};
  for (const key of COLOR_KEYS) {
    const hex = source[key];
    if (typeof hex === 'string' && HEX_COLOR.test(hex.trim())) colors[key] = hex.trim().toLowerCase();
  }
  return Object.keys(colors).length ? colors : null;
}

function mixHex(a, b, weightA) {
  const parse = (hex) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (x, y) => Math.max(0, Math.min(255, Math.round(x * weightA + y * (1 - weightA))));
  return '#' + [channel(ar, br), channel(ag, bg), channel(ab, bb)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}

function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case b: h = (r - g) / d + 4; break;
    default: h = (b - r) / d + 2;
  }
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

function relLuminance(hex) {
  const channel = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [1, 3, 5].map((start) => channel(parseInt(hex.slice(start, start + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(lumA, lumB) {
  const hi = Math.max(lumA, lumB);
  const lo = Math.min(lumA, lumB);
  return (hi + 0.05) / (lo + 0.05);
}

/* A dimmed twin of any user accent, guaranteed 3:1 against the sheet.
   Darkens the hue until the AA floor is met; on dark sheets that cannot work,
   walks back up the lightness ramp instead. */
function deriveBarDim(accentHex, backgroundHex) {
  const [h, s, l] = hexToHsl(accentHex);
  const bgLum = relLuminance(backgroundHex);
  const darken = (lightness) => hslToHex(h, s, Math.max(0, Math.min(1, lightness)));
  for (let step = 0; step <= 40; step += 1) {
    const candidate = darken(l - step * 0.02);
    if (contrastRatio(relLuminance(candidate), bgLum) >= 3.0) return candidate;
  }
  for (let step = 1; step <= 40; step += 1) {
    const candidate = darken(l + step * 0.02);
    if (contrastRatio(relLuminance(candidate), bgLum) >= 3.0) return candidate;
  }
  return darken(1);
}

function cardOptions(options) {
  const value = options || {};
  const order = Array.isArray(value.order) ? value.order : [];
  const normalizedOrder = [
    ...new Set([...order.filter((id) => SECTION_ORDER.includes(id)), ...SECTION_ORDER]),
  ];
  return {
    theme: ['atlas', 'coast', 'sakura', 'ukiyo', 'night', 'ember'].includes(value.theme) ? value.theme : 'atlas',
    layout: value.layout === 'story' ? 'story' : 'square',
    order: normalizedOrder,
    colors: sanitizeCardColors(value.colors),
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

/* Inline overrides for the five user-editable tokens. Computed here, not in CSS,
   so the exported PNG resolves them exactly once, at the element. */
function cardColorStyle(theme, colors) {
  if (!colors) return undefined;
  const background = colors.bg || THEME_BACKGROUND[theme] || THEME_BACKGROUND.atlas;
  const style = {};
  if (colors.bg) style['--card-bg'] = colors.bg;
  if (colors.soft) style['--card-soft'] = colors.soft;
  if (colors.ink) style['--card-ink'] = colors.ink;
  if (colors.muted) style['--card-muted'] = colors.muted;
  if (colors.signal) style['--card-signal'] = colors.signal;
  if (colors.globe) style['--card-globe'] = colors.globe;
  if (colors.bars) {
    style['--card-accent'] = colors.bars;
    style['--card-bar-dim'] = deriveBarDim(colors.bars, background);
    style['--card-seg-2'] = mixHex(colors.bars, background, 0.72);
    style['--card-seg-3'] = mixHex(colors.bars, background, 0.32);
    style['--card-seg-4'] = mixHex(colors.bars, background, 0.18);
  }
  return style;
}

function timeStat(profile, media) {
  if (profile.mediaType === 'manga') {
    return { label: media.timeLabel, value: displayNumber(profile.daysRead) };
  }
  return { label: 'Hours watched', value: displayNumber(profile.hours) };
}

/* The maker's mark: the brand globe, traced from the original raster so the
   continents are real transparent holes. Inlined (not an <img>) so the single
   fill inherits `currentColor` — the studio can paint the globe any colour
   without touching the file. Regenerate with trace-globe.py. */
const GLOBE_PATH =
  'M125.5,249.5a124.0,124.0 0 1,0 248.0,0a124.0,124.0 0 1,0 -248.0,0Z' +
  ' M206.7,335.9C207.9,334.7 207.6,331.1 205.9,325.3C204.5,320.7 206.4,315.3 216.3,295.5' +
  'C222.6,282.9 225.2,276.5 226.4,270.6C228.3,261.5 227.9,260.5 221.9,259.5C218.8,259.0' +
  ' 215.7,257.0 208.8,250.9L190.4,243.0C181.6,243.0 181.0,242.9 179.1,240.4C176.2,236.7' +
  ' 175.6,234.1 177.1,231.4C178.2,229.3 178.1,228.7 176.7,227.2C175.1,225.6 174.6,225.7' +
  ' 168.4,227.9L159.2,228.3C155.4,225.5 155.5,223.2 159.5,217.7L169.8,213.6L193.9,202.5' +
  'C203.4,196.1 211.4,190.1 211.7,189.4C212.3,187.8 210.7,183.6 208.4,180.5C207.2,178.9' +
  ' 205.4,178.4 198.7,178.0L190.5,172.5L197.7,165.0C204.5,162.7 205.1,162.6 207.7,164.2' +
  'C210.8,166.0 216.3,165.6 218.0,163.5C219.3,161.9 218.3,159.5 215.1,156.6C213.0,154.7' +
  ' 212.8,154.7 201.3,156.8C187.8,159.4 185.6,160.5 173.8,171.8C160.5,184.5 148.9,204.1' +
  ' 144.4,221.3L147.2,231.1C150.6,234.1 152.6,235.0 157.1,235.5C160.1,235.9 163.1,236.5' +
  ' 163.6,236.8C164.2,237.2 166.7,241.0 169.3,245.2L170.5,256.2C167.4,258.9 167.0,259.9' +
  ' 167.0,264.1L178.2,274.9C184.4,278.2 190.0,281.3 190.7,281.9C191.5,282.6 191.7,286.5' +
  ' 191.3,295.7L195.4,321.9C197.9,329.2 200.3,335.6 200.6,336.1C201.4,337.4 205.4,337.2' +
  ' 206.7,335.9Z' +
  ' M291.8,301.8C292.3,301.1 296.4,291.7 300.9,281.0C305.9,268.9 310.9,258.7 314.0,254.2' +
  'C316.7,250.2 318.7,246.3 318.4,245.6C317.8,244.0 312.6,241.6 310.1,241.8C305.8,242.0' +
  ' 304.1,240.9 303.1,237.2C301.6,232.0 301.7,231.8 304.8,232.5C308.1,233.2 316.5,229.8' +
  ' 317.4,227.5C317.7,226.6 317.0,225.1 315.5,223.8C312.7,221.4 312.4,219.4 314.4,216.8' +
  'C316.2,214.4 318.2,214.5 327.8,218.0C337.5,221.5 337.9,221.7 340.3,224.7C341.3,226.0' +
  ' 343.4,227.7 344.9,228.4C347.1,229.6 347.9,231.2 349.4,237.2C351.7,246.4 353.4,249.2' +
  ' 356.3,248.8C358.4,248.5 358.5,248.0 358.3,240.5C357.9,224.5 349.9,202.1 339.3,187.1' +
  'C333.7,179.2 323.3,168.2 318.0,164.5L304.5,165.2L291.4,164.2C289.3,161.8 287.0,160.0' +
  ' 285.8,160.0C282.9,160.0 267.0,169.8 267.0,171.6C267.0,172.5 267.5,174.0 268.0,175.1' +
  'C269.4,177.7 268.7,178.7 260.7,185.5C256.5,189.0 254.0,191.8 254.2,192.9C255.0,196.9' +
  ' 267.2,198.4 280.3,196.0L294.5,201.0C298.1,204.6 301.0,208.0 301.0,208.6C301.0,209.3' +
  ' 300.1,212.0 299.0,214.5L280.7,218.5C271.8,218.1 260.7,217.4 256.0,217.0C251.4,216.6' +
  ' 246.9,216.5 246.1,216.8C244.8,217.3 238.0,231.0 238.0,233.2C238.0,233.7 240.3,238.0' +
  ' 243.1,242.6L258.4,251.0C265.5,251.0 269.1,251.4 269.7,252.2C271.3,254.2 274.5,267.9' +
  ' 277.6,285.0C279.1,293.5 280.8,301.1 281.3,301.8C281.8,302.4 284.2,303.0 286.5,303.0' +
  'C288.8,303.0 291.2,302.4 291.8,301.8Z';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
  return node;
}

export function globeMark(size = 'md') {
  const cls = 'globe-mark' + (size !== 'md' ? ' globe-mark-' + size : '');
  const svg = svgElement('svg', {
    viewBox: '0 0 500 500',
    class: cls,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  svg.append(svgElement('path', { d: GLOBE_PATH, fill: 'currentColor', 'fill-rule': 'evenodd' }));
  return svg;
}

export function globeStamp(size = 'md') {
  return globeMark(size);
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
            el('p', { class: 'export-archetype-caption' }, 'Your archetype'),
            el('h3', { class: 'export-archetype-label' }, taste.label),
            el('p', { class: 'export-archetype-blurb' }, taste.blurb)
          ),
          signature
            ? section(
                'Standout rating',
                el(
                  'div',
                  { class: 'export-standout' },
                  el(
                    'div',
                    { class: 'export-insight-row' },
                    el(
                      'span',
                      {
                        class: 'export-insight-value num',
                        dataset: { sign: signatureGap === 0 ? 'level' : signatureGap > 0 ? 'above' : 'below' },
                      },
                      signatureGap === 0 ? '±0' : (signatureGap > 0 ? '+' : '-') + Math.abs(signatureGap)
                    ),
                    el(
                      'span',
                      { class: 'export-insight-line' },
                      signatureGap === 0
                        ? 'points, in line with its ' + profile.source + ' average'
                        : 'points ' + (signatureGap > 0 ? 'above' : 'below') + ' its ' + profile.source + ' average'
                    )
                  ),
                  el('p', { class: 'export-standout-title' }, signature.title)
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
    formats: formatsSection(
      formats,
      profile.source,
      profile
    ),
    years: yearsSection(
      years,
      profile.source,
      profile
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
  const colorStyle = cardColorStyle(prefs.theme, prefs.colors);
  return el(
    'article',
    {
      class: 'export-card',
      dataset: { theme: prefs.theme, layout: prefs.layout },
      'aria-label': media.label + ' Wrapped for ' + profile.name,
      style: colorStyle || null,
    },
    el(
      'header',
      { class: 'export-card-header' },
      el('h2', { class: 'export-card-title' }, media.label + ' Wrapped'),
      globeStamp('sm')
    ),
    el(
      'span',
      { class: 'export-watermark', 'aria-hidden': 'true' },
      globeMark('lg')
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
        el('span', { class: 'export-card-footer-mark' },
          globeMark('xs'),
          'ANIGLOBE')
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