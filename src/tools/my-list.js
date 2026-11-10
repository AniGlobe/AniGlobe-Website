/**
 * My List: search the catalogue, track what you watch or read, see your year.
 * Signed-in users sync to the account; guests keep entries in this browser.
 */

import { el, render, setStatus } from '../lib.js';
import {
  LIBRARY_STATUSES,
  STATUS_LABELS,
  exportLibrary,
  listLibrary,
  removeEntry,
  saveEntry,
  searchCatalogue,
} from '../library.js';
import { getSession } from '../auth.js';

const SEARCH_DEBOUNCE_MS = 280;

const STATE = {
  status: '',
  query: '',
  sort: 'updated',
};

function statusOptions() {
  return LIBRARY_STATUSES.map((status) => el('option', { value: status }, STATUS_LABELS[status] || status));
}

function entryTotal(entry) {
  if (entry.chapters != null) return entry.chapters;
  if (entry.episodes != null) return entry.episodes;
  return null;
}

function entryKind(entry) {
  return entry.chapters != null ? 'manga' : 'anime';
}

export default {
  id: 'my-list',
  title: 'My List',
  blurb: 'Track what you watch and read.',

  async mount(root) {
    let state = { entries: [], stats: null, guest: !getSession() };
    let results = [];
    let searching = false;
    let destroyed = false;

    const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const searchInput = el('input', {
      type: 'search',
      id: 'my-list-search',
      placeholder: 'Search anime and manga',
      autocomplete: 'off',
      'aria-label': 'Search the catalogue',
    });
    const filterSelect = el('select', { id: 'my-list-status', 'aria-label': 'Filter by status' },
      el('option', { value: '' }, 'All statuses'),
      ...statusOptions());
    const sortSelect = el('select', { id: 'my-list-sort', 'aria-label': 'Sort by' },
      el('option', { value: 'updated' }, 'Recently updated'),
      el('option', { value: 'title' }, 'Title'),
      el('option', { value: 'status' }, 'Status'),
      el('option', { value: 'score' }, 'Score'),
      el('option', { value: 'year' }, 'Year'));
    const resultsList = el('ul', { class: 'my-list-results' });
    const resultsWrap = el('section', { class: 'my-list-search-panel', hidden: true },
      el('h2', { class: 'panel-title' }, 'Results'),
      resultsList);
    const libraryList = el('ul', { class: 'my-list-entries' });
    const statsWrap = el('div', { class: 'my-list-stats' });
    const libraryEmpty = el('p', { class: 'account-danger-note' }, 'Nothing tracked yet. Search for a title above and add it to your list.');
    const exportButton = el('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Export my list');

    function sortedEntries() {
      const entries = state.entries.slice();
      if (STATE.sort === 'title') entries.sort((a, b) => String(a.title).localeCompare(String(b.title)));
      else if (STATE.sort === 'status') entries.sort((a, b) => String(a.status).localeCompare(String(b.status)));
      else if (STATE.sort === 'score') entries.sort((a, b) => (b.score || 0) - (a.score || 0));
      else if (STATE.sort === 'year') entries.sort((a, b) => (b.year || 0) - (a.year || 0));
      else entries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return entries;
    }

    function renderStats() {
      const stats = state.stats;
      if (!stats || !stats.total) {
        render(statsWrap);
        return;
      }
      const statusRow = LIBRARY_STATUSES
        .filter((key) => stats.byStatus[key])
        .map((key) => el('div', { class: 'kpi' },
          el('span', { class: 'kpi-label' }, STATUS_LABELS[key] || key),
          el('strong', { class: 'kpi-value num' }, String(stats.byStatus[key]))));
      render(
        statsWrap,
        el('div', { class: 'kpis' }, ...statusRow),
        stats.topGenres && stats.topGenres.length
          ? el(
              'div',
              { class: 'my-list-genres' },
              el('h3', { class: 'panel-title' }, 'Top genres'),
              el('div', { class: 'my-list-genre-row' }, ...stats.topGenres.map((genre) =>
                el('span', { class: 'my-list-genre' }, genre.name + ' ' + genre.count)))
            )
          : null,
        stats.byYear && stats.byYear.length
          ? el(
              'div',
              { class: 'my-list-years' },
              el('h3', { class: 'panel-title' }, 'By year'),
              el('div', { class: 'my-list-year-row' }, ...stats.byYear.map((row) =>
                el('span', { class: 'my-list-year' }, row.year + ' · ' + row.count)))
            )
          : null
      );
    }

    function renderLibrary() {
      const entries = sortedEntries().filter((entry) => !STATE.status || entry.status === STATE.status);
      libraryEmpty.hidden = entries.length > 0;
      render(
        libraryList,
        ...entries.map((entry) => {
          const total = entryTotal(entry);
          const progressLabel = total != null ? entry.progress + ' / ' + total : String(entry.progress);
          const remove = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Remove');
          remove.addEventListener('click', async () => {
            remove.disabled = true;
            try {
              const next = await removeEntry(entry.mediaId);
              state.entries = next.entries;
              state.stats = next.stats;
              renderLibrary();
              renderStats();
              setStatus(status, 'Removed from your list.', 'info');
            } catch (error) {
              setStatus(status, error.message || 'Could not remove that title.', 'error');
              remove.disabled = false;
            }
          });
          return el(
            'li',
            { class: 'my-list-entry' },
            el(
              'button',
              { class: 'my-list-entry-main', type: 'button' },
              entry.coverUrl
                ? el('img', { class: 'my-list-cover', src: entry.coverUrl, alt: '', loading: 'lazy' })
                : el('span', { class: 'my-list-cover is-empty', 'aria-hidden': 'true' }),
              el(
                'span',
                { class: 'my-list-entry-text' },
                el('span', { class: 'my-list-entry-title' }, entry.title),
                el('span', { class: 'my-list-entry-meta' },
                  (STATUS_LABELS[entry.status] || entry.status) + ' · ' + progressLabel + (entry.score != null ? ' · ' + entry.score + '/10' : '') + (entry.year ? ' · ' + entry.year : ''))
              )
            ),
            remove
          );
        })
      );
    }

    function renderResults() {
      render(
        resultsList,
        ...results.map((media) => {
          const add = el('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Add to list');
          add.addEventListener('click', async () => {
            add.disabled = true;
            try {
              const next = await saveEntry({ media, status: 'PLANNING', progress: 0 });
              state.entries = next.entries;
              state.stats = next.stats;
              renderLibrary();
              renderStats();
              setStatus(status, 'Added "' + media.title + '" to your list.', 'info');
            } catch (error) {
              setStatus(status, error.message || 'Could not add that title.', 'error');
            } finally {
              add.disabled = false;
            }
          });
          const total = media.chapters != null ? media.chapters : media.episodes;
          return el(
            'li',
            { class: 'my-list-result' },
            media.coverUrl
              ? el('img', { class: 'my-list-cover', src: media.coverUrl, alt: '', loading: 'lazy' })
              : el('span', { class: 'my-list-cover is-empty', 'aria-hidden': 'true' }),
            el(
              'div',
              { class: 'my-list-result-text' },
              el('span', { class: 'my-list-result-title' }, media.title),
              el('span', { class: 'my-list-result-meta' },
                [media.format, total != null ? total + (media.chapters != null ? ' chapters' : ' episodes') : null, media.year]
                  .filter(Boolean).join(' · '))
            ),
            add
          );
        })
      );
    }

    async function runSearch() {
      const query = searchInput.value.trim();
      if (!query) {
        results = [];
        searching = false;
        resultsWrap.hidden = true;
        return;
      }
      searching = true;
      resultsWrap.hidden = false;
      render(resultsList, el('li', { class: 'my-list-result' }, el('span', { class: 'my-list-result-meta' }, 'Searching…')));
      try {
        results = await searchCatalogue(query);
        if (destroyed) return;
        searching = false;
        if (!results.length) {
          render(resultsList, el('li', { class: 'my-list-result' },
            el('span', { class: 'my-list-result-meta' }, 'No titles in the catalogue match "' + query + '" yet. The catalogue refreshes daily.')));
          return;
        }
        renderResults();
      } catch (error) {
        if (destroyed) return;
        searching = false;
        render(resultsList, el('li', { class: 'my-list-result' },
          el('span', { class: 'my-list-result-meta' }, error.message || 'Could not search the catalogue.')));
      }
    }

    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
    });

    filterSelect.addEventListener('change', () => {
      STATE.status = filterSelect.value;
      renderLibrary();
    });
    sortSelect.addEventListener('change', () => {
      STATE.sort = sortSelect.value;
      renderLibrary();
    });
    exportButton.addEventListener('click', async () => {
      exportButton.disabled = true;
      try {
        await exportLibrary('json');
        setStatus(status, 'Your list has been exported.', 'info');
      } catch (error) {
        setStatus(status, error.message || 'Could not export your list.', 'error');
      } finally {
        exportButton.disabled = false;
      }
    });

    render(
      root,
      el(
        'div',
        { class: 'tool-head' },
        el('h1', {}, 'My List'),
        el('p', {}, state.guest
          ? 'Guest mode: entries stay in this browser. Create an account to sync them everywhere.'
          : 'Your list syncs to your account. Search the catalogue to add what you watch and read.')
      ),
      el(
        'section',
        { class: 'panel account-panel' },
        el('h2', { class: 'panel-title' }, 'Find a title'),
        el('div', { class: 'field' }, el('label', { for: 'my-list-search' }, 'Search'), searchInput),
        resultsWrap
      ),
      el(
        'section',
        { class: 'panel account-panel' },
        el('h2', { class: 'panel-title' }, 'Your list'),
        el(
          'div',
          { class: 'my-list-toolbar' },
          el('div', { class: 'field' }, el('label', { for: 'my-list-status' }, 'Status'), filterSelect),
          el('div', { class: 'field' }, el('label', { for: 'my-list-sort' }, 'Sort'), sortSelect),
          exportButton
        ),
        statsWrap,
        libraryList,
        libraryEmpty
      ),
      status
    );

    try {
      const payload = await listLibrary();
      if (destroyed) return;
      state.entries = payload.entries;
      state.stats = payload.stats;
    } catch (error) {
      setStatus(status, error.message || 'Could not load your list.', 'error');
    }
    renderLibrary();
    renderStats();

    return () => {
      destroyed = true;
      clearTimeout(searchTimer);
    };
  },
};
