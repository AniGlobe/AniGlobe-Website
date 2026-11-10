/**
 * Browse the catalogue: a database viewer in the spirit of MAL, AniList, and
 * ComicK. Filters, sorting, and pagination all run against our own
 * snapshot, so browsing never waits on a provider.
 */

import { el, render, setStatus } from '../lib.js';
import { getSession } from '../auth.js';
import { saveEntry } from '../library.js';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 280;

const SORTS = [
  { value: 'popularity', label: 'Most popular' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'year', label: 'Newest first' },
  { value: 'title', label: 'Title A-Z' },
];

const SCORES = [
  { value: '', label: 'Any score' },
  { value: '6', label: '6.0 or higher' },
  { value: '7', label: '7.0 or higher' },
  { value: '8', label: '8.0 or higher' },
  { value: '9', label: '9.0 or higher' },
];

function state() {
  return {
    type: 'anime',
    query: '',
    genres: [],
    year: '',
    format: '',
    season: '',
    status: '',
    minScore: '',
    sort: 'popularity',
    offset: 0,
  };
}

export default {
  id: 'browse',
  title: 'Browse',
  blurb: 'Search the anime and manga catalogue.',

  async mount(root) {
    let filters = state();
    let destroyed = false;
    let loading = false;
    let pending = false;

    const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const typePick = el('div', { class: 'browse-types', role: 'tablist', 'aria-label': 'Media type' });
    const searchInput = el('input', {
      type: 'search',
      id: 'browse-search',
      placeholder: 'Search titles',
      autocomplete: 'off',
      'aria-label': 'Search titles',
    });
    const genreChips = el('div', { class: 'browse-genres', role: 'group', 'aria-label': 'Genres' });
    const yearSelect = el('select', { id: 'browse-year', 'aria-label': 'Year' });
    const formatSelect = el('select', { id: 'browse-format', 'aria-label': 'Format' });
    const seasonSelect = el('select', { id: 'browse-season', 'aria-label': 'Season' });
    const statusSelect = el('select', { id: 'browse-status', 'aria-label': 'Status' });
    const scoreSelect = el('select', { id: 'browse-score', 'aria-label': 'Minimum score' },
      ...SCORES.map((score) => el('option', { value: score.value }, score.label)));
    const sortSelect = el('select', { id: 'browse-sort', 'aria-label': 'Sort by' },
      ...SORTS.map((sort) => el('option', { value: sort.value }, sort.label)));
    const clearButton = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Clear filters');
    const activeFilters = el('p', { class: 'browse-active', 'aria-live': 'polite' });
    const grid = el('div', { class: 'browse-grid' });
    const resultCount = el('p', { class: 'browse-count' });
    const previousButton = el('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Previous');
    const nextButton = el('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Next');
    const pager = el('div', { class: 'browse-pager' }, previousButton, resultCount, nextButton);
    const emptyState = el('p', { class: 'account-danger-note' },
      'The catalogue is empty. It fills itself as the daily sync runs, so check back later or search by title above.');

    function paintTypes() {
      render(
        typePick,
        ...[
          { value: 'anime', label: 'Anime' },
          { value: 'manga', label: 'Manga' },
        ].map((option) => {
          const button = el('button', {
            class: 'btn btn-sm ' + (filters.type === option.value ? 'btn-primary' : 'btn-quiet'),
            type: 'button',
            role: 'tab',
            'aria-selected': String(filters.type === option.value),
            dataset: { type: option.value },
          }, option.label);
          return button;
        })
      );
    }

    function paintGenres(facets) {
      render(
        genreChips,
        ...facets.genres.map((genre) => {
          const active = filters.genres.includes(genre.value);
          const chip = el(
            'button',
            {
              class: 'browse-chip' + (active ? ' is-active' : ''),
              type: 'button',
              'aria-pressed': String(active),
              dataset: { genre: genre.value },
            },
            genre.value,
            el('span', { class: 'browse-chip-count' }, String(genre.count))
          );
          chip.addEventListener('click', () => {
            const index = filters.genres.indexOf(genre.value);
            if (index >= 0) filters.genres.splice(index, 1);
            else filters.genres.push(genre.value);
            paintGenres(facets);
            resetAndLoad();
          });
          return chip;
        })
      );
    }

    function paintFacets(facets) {
      paintGenres(facets);
      render(
        yearSelect,
        el('option', { value: '' }, 'All years'),
        ...facets.years.map((year) => el('option', { value: String(year.value) }, year.value + ' (' + year.count + ')'))
      );
      render(
        formatSelect,
        el('option', { value: '' }, 'All formats'),
        ...facets.formats.map((format) => el('option', { value: format.value }, format.value + ' (' + format.count + ')'))
      );
      render(
        seasonSelect,
        el('option', { value: '' }, 'All seasons'),
        ...facets.seasons.map((season) => el('option', { value: season.value }, season.value + ' (' + season.count + ')'))
      );
      render(
        statusSelect,
        el('option', { value: '' }, 'All statuses'),
        ...facets.statuses.map((status) => el('option', { value: status.value }, status.value + ' (' + status.count + ')'))
      );
      yearSelect.value = filters.year;
      formatSelect.value = filters.format;
      seasonSelect.value = filters.season;
      statusSelect.value = filters.status;
      scoreSelect.value = filters.minScore;
    }

    function paintActiveFilters() {
      const parts = [];
      if (filters.query) parts.push('“' + filters.query + '”');
      if (filters.genres.length) parts.push(filters.genres.join(' or '));
      if (filters.format) parts.push(filters.format);
      if (filters.season) parts.push(filters.season);
      if (filters.year) parts.push(filters.year);
      if (filters.status) parts.push(filters.status);
      if (filters.minScore) parts.push(filters.minScore + '+ rating');
      clearButton.hidden = parts.length === 0;
      activeFilters.textContent = parts.length ? 'Filtering by ' + parts.join(' · ') : '';
    }

    function mediaCard(media) {
      const meta = [
        media.format,
        media.year,
        media.averageRating != null ? media.averageRating + '/10' : null,
      ].filter(Boolean).join(' · ');
      const add = el('button', { class: 'btn btn-outline btn-sm browse-add', type: 'button' }, 'Add to list');
      add.addEventListener('click', async (event) => {
        event.stopPropagation();
        add.disabled = true;
        try {
          await saveEntry({ media, status: 'PLANNING', progress: 0 });
          setStatus(status, 'Added "' + media.title + '" to your list.', 'info');
          add.textContent = 'Added';
        } catch (error) {
          setStatus(status, error.message || 'Could not add that title.', 'error');
          add.disabled = false;
        }
      });
      const card = el(
        'article',
        { class: 'browse-card' },
        media.coverUrl
          ? el('img', { class: 'browse-cover', src: media.coverUrl, alt: '', loading: 'lazy' })
          : el('span', { class: 'browse-cover is-empty', 'aria-hidden': 'true' }),
        el('h3', { class: 'browse-card-title' }, media.title),
        el('p', { class: 'browse-card-meta' }, meta),
        add
      );
      card.addEventListener('click', () => openMediaSheet(media));
      return card;
    }

    function openMediaSheet(media) {
      const details = el('dl', { class: 'media-sheet-details' },
        el('div', {}, el('dt', {}, 'Type'), el('dd', {}, media.mediaType || filters.type)),
        el('div', {}, el('dt', {}, 'Format'), el('dd', {}, media.format || 'Not listed')),
        el('div', {}, el('dt', {}, 'Status'), el('dd', {}, media.status || 'Unknown')),
        el('div', {}, el('dt', {}, 'Episodes'), el('dd', {}, media.episodes != null ? String(media.episodes) : 'Not listed')),
        el('div', {}, el('dt', {}, 'Chapters'), el('dd', {}, media.chapters != null ? String(media.chapters) : 'Not listed')),
        el('div', {}, el('dt', {}, 'Year'), el('dd', {}, media.year != null ? String(media.year) : 'Unknown')),
        el('div', {}, el('dt', {}, 'Rating'), el('dd', {}, media.averageRating != null ? media.averageRating + '/10' : 'Not rated'))
      );
      const genres = media.genres && media.genres.length
        ? el('ul', { class: 'media-sheet-genres' }, ...media.genres.slice(0, 12).map((genre) => el('li', {}, genre)))
        : null;
      const addButton = el('button', { class: 'btn btn-primary', type: 'button' }, getSession() ? 'Add to my list' : 'Save to this browser');
      addButton.addEventListener('click', async () => {
        addButton.disabled = true;
        try {
          await saveEntry({ media, status: 'PLANNING', progress: 0 });
          setStatus(status, 'Added "' + media.title + '" to your list.', 'info');
          dialog.close();
        } catch (error) {
          setStatus(sheetStatus, error.message || 'Could not add that title.', 'error');
          addButton.disabled = false;
        }
      });
      const sheetStatus = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
      const dialog = el(
        'dialog',
        { class: 'auth-dialog media-sheet', 'aria-labelledby': 'media-sheet-title' },
        el('div', { class: 'auth-dialog-head' },
          el('div', {},
            el('h2', { id: 'media-sheet-title', class: 'auth-dialog-title' }, media.title),
            el('p', { class: 'auth-dialog-subtitle' }, [media.format, media.year].filter(Boolean).join(' · '))),
          el('button', { class: 'auth-dialog-close', type: 'button', 'aria-label': 'Close details' }, '×')),
        el('div', { class: 'media-sheet-body' },
          media.coverUrl ? el('img', { class: 'media-sheet-cover', src: media.coverUrl, alt: '' }) : null,
          el('div', {},
            media.synopsis ? el('p', { class: 'media-sheet-synopsis' }, media.synopsis) : el('p', { class: 'media-sheet-synopsis' }, 'No synopsis yet.'),
            details,
            genres)),
        sheetStatus,
        el('div', { class: 'entry-editor-actions' }, addButton)
      );
      document.body.append(dialog);
      dialog.querySelector('.auth-dialog-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => dialog.remove());
      dialog.showModal();
      addButton.focus();
    }

    async function load() {
      if (loading) {
        // A filter changed while the last request was in flight: remember it
        // so the newest filters always win.
        pending = true;
        return;
      }
      loading = true;
      const params = new URLSearchParams();
      params.set('type', filters.type);
      params.set('sort', filters.sort);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(filters.offset));
      if (filters.query) params.set('q', filters.query);
      if (filters.genres.length) params.set('genres', filters.genres.join(','));
      if (filters.year) params.set('year', filters.year);
      if (filters.format) params.set('format', filters.format);
      if (filters.season) params.set('season', filters.season);
      if (filters.status) params.set('status', filters.status);
      if (filters.minScore) params.set('minScore', filters.minScore);
      paintActiveFilters();
      render(grid, el('p', { class: 'account-danger-note' }, 'Loading the catalogue…'));
      try {
        const response = await fetch('/api/media/browse?' + params.toString(), { credentials: 'same-origin' });
        const payload = await response.json();
        if (destroyed) return;
        if (!response.ok) throw new Error(payload && payload.error ? payload.error : 'Could not load the catalogue.');
        paintFacets(payload.facets || { genres: [], years: [], formats: [], seasons: [], statuses: [] });
        const items = payload.items || [];
        render(grid, ...items.map((media) => mediaCard(media)));
        emptyState.hidden = items.length > 0;
        const total = payload.total || 0;
        resultCount.textContent = total
          ? (filters.offset + 1) + '–' + Math.min(filters.offset + PAGE_SIZE, total) + ' of ' + total
          : '0 titles';
        previousButton.disabled = filters.offset <= 0;
        nextButton.disabled = filters.offset + PAGE_SIZE >= total;
        pager.hidden = total === 0;
      } catch (error) {
        if (destroyed) return;
        render(grid, el('p', { class: 'account-danger-note' }, error.message || 'Could not load the catalogue.'));
        emptyState.hidden = true;
        pager.hidden = true;
      } finally {
        loading = false;
        if (pending) {
          pending = false;
          load();
        }
      }
    }

    function resetAndLoad() {
      filters.offset = 0;
      load();
    }

    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filters.query = searchInput.value.trim();
        resetAndLoad();
      }, SEARCH_DEBOUNCE_MS);
    });
    typePick.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-type]');
      if (!button) return;
      filters.type = button.dataset.type;
      filters.genres = [];
      filters.year = '';
      filters.format = '';
      filters.season = '';
      filters.status = '';
      filters.minScore = '';
      searchInput.value = '';
      filters.query = '';
      paintTypes();
      resetAndLoad();
    });
    yearSelect.addEventListener('change', () => { filters.year = yearSelect.value; resetAndLoad(); });
    formatSelect.addEventListener('change', () => { filters.format = formatSelect.value; resetAndLoad(); });
    seasonSelect.addEventListener('change', () => { filters.season = seasonSelect.value; resetAndLoad(); });
    statusSelect.addEventListener('change', () => { filters.status = statusSelect.value; resetAndLoad(); });
    scoreSelect.addEventListener('change', () => { filters.minScore = scoreSelect.value; resetAndLoad(); });
    sortSelect.addEventListener('change', () => { filters.sort = sortSelect.value; resetAndLoad(); });
    clearButton.addEventListener('click', () => {
      const keepType = filters.type;
      filters = state();
      filters.type = keepType;
      searchInput.value = '';
      paintTypes();
      resetAndLoad();
    });
    previousButton.addEventListener('click', () => {
      filters.offset = Math.max(0, filters.offset - PAGE_SIZE);
      load();
    });
    nextButton.addEventListener('click', () => {
      filters.offset += PAGE_SIZE;
      load();
    });

    paintTypes();
    render(
      root,
      el(
        'div',
        { class: 'tool-head' },
        el('h1', {}, 'Browse'),
        el('p', {}, 'Search the anime and manga catalogue, filter it, and save what you watch.')
      ),
      el(
        'section',
        { class: 'panel account-panel' },
        el(
          'div',
          { class: 'browse-search-row' },
          el('div', { class: 'field' }, el('label', { for: 'browse-search' }, 'Search'), searchInput),
          clearButton
        ),
        typePick,
        el('div', { class: 'browse-genre-block' },
          el('span', { class: 'browse-label' }, 'Genres'),
          genreChips),
        el(
          'div',
          { class: 'browse-filters' },
          el('div', { class: 'field' }, el('label', { for: 'browse-year' }, 'Year'), yearSelect),
          el('div', { class: 'field' }, el('label', { for: 'browse-format' }, 'Format'), formatSelect),
          el('div', { class: 'field' }, el('label', { for: 'browse-season' }, 'Season'), seasonSelect),
          el('div', { class: 'field' }, el('label', { for: 'browse-status' }, 'Status'), statusSelect),
          el('div', { class: 'field' }, el('label', { for: 'browse-score' }, 'Score'), scoreSelect),
          el('div', { class: 'field' }, el('label', { for: 'browse-sort' }, 'Sort'), sortSelect)
        ),
        activeFilters,
        grid,
        emptyState,
        pager
      ),
      status
    );

    await load();
    return () => {
      destroyed = true;
      clearTimeout(searchTimer);
    };
  },
};
