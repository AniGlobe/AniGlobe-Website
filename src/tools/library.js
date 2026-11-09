/**
 * Public template library: browse templates other users published.
 * Replaces share links as the discovery path — no token in the URL,
 * just a public listing the backend serves from explicit opt-in rows.
 */

import { el, render, setStatus } from '../lib.js';
import { AuthError, getSession, listPublicTemplates, usePublicTemplate } from '../auth.js';

export default {
  id: 'library',
  title: 'Template library',
  blurb: 'Browse and reuse public Wrapped templates.',

  async mount(root) {
    const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const search = el('input', {
      type: 'search',
      id: 'library-search',
      placeholder: 'Search by name or author',
      'aria-label': 'Search templates',
    });
    const list = el('ul', { class: 'library-list' });
    const themeFilter = el('div', { class: 'library-filters', role: 'group', 'aria-label': 'Filter by theme' });
    const empty = el('p', { class: 'account-danger-note', hidden: true }, 'No public templates yet. Publish one from the card studio to appear here.');
    const noResults = el('p', { class: 'account-danger-note', hidden: true }, 'No templates match your filters.');
    const retryButton = el('button', { class: 'btn btn-outline btn-sm', type: 'button', hidden: true }, 'Retry');

    render(
      root,
      el(
        'div',
        { class: 'tool-head' },
        el('h1', {}, 'Template library'),
        el('p', {}, 'Templates other users published. Use one to save a copy to your account, then open the studio to apply it.')
      ),
      el(
        'section',
        { class: 'panel account-panel' },
        el('div', { class: 'field' }, el('label', { for: 'library-search' }, 'Search'), search),
        themeFilter,
        status,
        list,
        empty,
        noResults,
        retryButton
      )
    );

    let all = [];
    async function refresh() {
      setStatus(status, 'Loading library…', 'info');
      retryButton.hidden = true;
      try {
        all = await listPublicTemplates();
        setStatus(status, '', 'info');
      } catch (error) {
        all = [];
        setStatus(status, error instanceof AuthError ? error.message : 'Could not load the library. Check your connection and try again.', 'error');
        retryButton.hidden = false;
      }
      paint();
    }
    retryButton.addEventListener('click', refresh);

    let activeTheme = '';
    let lastFilterSig = '';
    function paintFilters() {
      // No hard-coded theme list: chips are derived from the templates
      // actually present, plus an "All themes" reset. Skip re-render when
      // nothing changed so search keystrokes keep focus.
      const themes = [...new Set(all.map((t) => t.theme).filter(Boolean))].sort();
      const sig = activeTheme + '|' + themes.join(',');
      if (sig === lastFilterSig) return;
      lastFilterSig = sig;
      render(
        themeFilter,
        el('button', { class: 'btn btn-sm ' + (!activeTheme ? 'btn-primary' : 'btn-quiet'), type: 'button', 'aria-pressed': String(!activeTheme), dataset: { theme: '' } }, 'All themes'),
        ...themes.map((theme) =>
          el('button', { class: 'btn btn-sm ' + (activeTheme === theme ? 'btn-primary' : 'btn-quiet'), type: 'button', 'aria-pressed': String(activeTheme === theme), dataset: { theme } }, theme)
        )
      );
    }

    function paint() {
      paintFilters();
      const query = search.value.trim().toLowerCase();
      const filtered = all.filter((t) =>
        (!activeTheme || t.theme === activeTheme) &&
        (!query || t.name.toLowerCase().includes(query) || t.author.toLowerCase().includes(query))
      );
      empty.hidden = !(all.length === 0 && !query && !activeTheme);
      noResults.hidden = !((query || activeTheme) && filtered.length === 0 && all.length > 0);
      render(
        list,
        ...filtered.map((template) => {
          const metaParts = [];
          if (template.theme) metaParts.push(template.theme);
          if (template.layout) metaParts.push(template.layout + ' card');
          if (template.sections != null) metaParts.push(template.sections + ' sections');
          metaParts.push(new Date(template.updatedAt).toLocaleDateString());
          return el(
            'li',
            { class: 'library-row' },
            el(
              'div',
              {},
              el('p', { class: 'library-name' }, template.name),
              el(
                'p',
                { class: 'library-meta' },
                el('a', { href: '#/profile?u=' + encodeURIComponent(template.author) }, '@' + template.author),
                metaParts.length ? ' · ' + metaParts.join(' · ') : ''
              )
            ),
            el('button', { class: 'btn btn-outline btn-sm library-use', type: 'button', dataset: { use: String(template.id) } }, 'Use template')
          );
        })
      );
    }

    themeFilter.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-theme]');
      if (!button) return;
      activeTheme = button.dataset.theme || '';
      lastFilterSig = '';
      paint();
      const refocus = themeFilter.querySelector('button[data-theme="' + activeTheme + '"]');
      if (refocus) refocus.focus();
      const shown = all.filter((t) => !activeTheme || t.theme === activeTheme).length;
      setStatus(status, shown + (shown === 1 ? ' template' : ' templates') + ' shown.', 'info');
    });

    search.addEventListener('input', paint);

    list.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-use]');
      if (!button || button.disabled) return;
      if (!getSession()) {
        setStatus(status, 'Log in to add a public template to your account.', 'error');
        return;
      }
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const result = await usePublicTemplate(button.dataset.use);
        setStatus(status, '"' + result.name + '" saved. Open the card studio to apply it.', 'info');
      } catch (error) {
        setStatus(status, error instanceof AuthError ? error.message : 'Could not add that template.', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Use template';
      }
    });

    await refresh();
  },
};
