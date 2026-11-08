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
    const empty = el('p', { class: 'account-danger-note' }, 'No public templates yet. Publish one from the card studio to appear here.');

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
        status,
        list,
        empty
      )
    );

    let all = [];
    async function refresh() {
      all = await listPublicTemplates();
      paint();
    }

    function paint() {
      const query = search.value.trim().toLowerCase();
      const filtered = query
        ? all.filter((t) => t.name.toLowerCase().includes(query) || t.author.toLowerCase().includes(query))
        : all;
      empty.hidden = filtered.length > 0;
      render(
        list,
        ...filtered.map((template) =>
          el(
            'li',
            { class: 'library-row' },
            el(
              'div',
              {},
              el('p', { class: 'library-name' }, template.name),
              el('p', { class: 'library-meta' }, '@' + template.author + (template.theme ? ' · ' + template.theme : '') + ' · ' + new Date(template.updatedAt).toLocaleDateString())
            ),
            el('button', { class: 'btn btn-outline btn-sm', type: 'button', dataset: { use: String(template.id) } }, 'Use template')
          )
        )
      );
    }

    search.addEventListener('input', paint);

    list.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-use]');
      if (!button) return;
      if (!getSession()) {
        setStatus(status, 'Log in to add a public template to your account.', 'error');
        return;
      }
      try {
        const result = await usePublicTemplate(button.dataset.use);
        setStatus(status, '"' + result.name + '" saved. Open the card studio to apply it.', 'info');
      } catch (error) {
        setStatus(status, error instanceof AuthError ? error.message : 'Could not add that template.', 'error');
      }
    });

    await refresh();
  },
};
