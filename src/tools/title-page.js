/**
 * A title on its own page: #/title/<id>
 *
 * Rendered by the shell directly (like #/profile and #/reset), not through
 * the tool registry, so it has an address of its own and can be shared.
 */

import { el, render, setStatus } from '../lib.js';
import { getSession } from '../auth.js';
import { listLibrary, saveEntry } from '../library.js';
import { openEntryEditor } from './entry-editor.js';

/** The id in the address: #/title/123 */
export function titleIdFromHash() {
  const hash = window.location.hash || '';
  const match = hash.match(/#\/title\/(\d+)/);
  return match ? Number(match[1]) : 0;
}

async function fetchMedia(id) {
  const response = await fetch('/api/media/' + encodeURIComponent(id), { credentials: 'same-origin' });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload && payload.media ? payload.media : null;
}

/** A short fact, like "26 episodes" or "1998". */
function facts(media) {
  const list = [];
  if (media.format) list.push(media.format);
  if (media.status) list.push(media.status);
  if (media.year) list.push(String(media.year));
  if (media.season) list.push(media.season.charAt(0) + media.season.slice(1).toLowerCase());
  if (media.episodes != null) list.push(media.episodes + ' episodes');
  if (media.chapters != null) list.push(media.chapters + ' chapters');
  if (media.volumes != null) list.push(media.volumes + ' volumes');
  if (media.averageRating != null) list.push(media.averageRating + '/10');
  return list;
}

export function renderTitle(root) {
  const id = titleIdFromHash();
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const body = el('div', { class: 'account-stack' }, el('p', { class: 'account-danger-note' }, 'Loading the title…'));

  render(
    root,
    el('div', { class: 'tool-head' },
      el('h1', {}, 'Title'),
      el('p', {}, 'Everything about one anime or manga.')),
    el('section', { class: 'panel account-panel' }, body),
    el('p', { style: { marginTop: '16px' } },
      el('a', { class: 'btn btn-quiet', href: '#/browse' }, 'Back to Browse')),
    status
  );

  if (!id) {
    render(body, el('p', { class: 'account-danger-note' }, 'That address does not name a title.'));
    return;
  }

  fetchMedia(id).then(async (media) => {
    if (!media) {
      render(body, el('p', { class: 'account-danger-note' }, 'That title is not in the catalogue yet.'));
      return;
    }
    document.title = media.title + ' | AniGlobe';

    // The genres and the tags are different things: the broad genres, and
    // the fine-grained ones. Each links back into the browse page.
    const genreLinks = el('ul', { class: 'title-links' },
      ...(media.genres || []).map((genre) => el('li', {},
        el('a', { class: 'title-link', href: '#/browse?genre=' + encodeURIComponent(genre) }, genre))));
    const tagLinks = el('ul', { class: 'title-links title-links-tags' },
      ...(media.tags || []).map((tag) => el('li', {},
        el('a', { class: 'title-link', href: '#/browse?tags=' + encodeURIComponent(tag) }, tag))));

    const addButton = el('button', { class: 'btn btn-primary', type: 'button' },
      getSession() ? 'Add to my list' : 'Save to this browser');

    let existing = null;
    try {
      const library = await listLibrary();
      existing = library.entries.find((entry) => entry.mediaId === media.id) || null;
    } catch {
      existing = null;
    }
    if (existing) addButton.textContent = 'Edit my entry';

    addButton.addEventListener('click', async () => {
      if (existing) {
        const editor = openEntryEditor(existing, {
          onSaved: () => setStatus(status, 'Entry saved.', 'info'),
          onStatus: (message) => setStatus(status, message, 'info'),
        });
        editor.setTrigger(addButton);
        return;
      }
      addButton.disabled = true;
      try {
        await saveEntry({ media, status: 'PLANNING', progress: 0 });
        setStatus(status, 'Added "' + media.title + '" to your list.', 'info');
        addButton.textContent = 'Added';
      } catch (error) {
        setStatus(status, error.message || 'Could not add that title.', 'error');
        addButton.disabled = false;
      }
    });

    render(
      body,
      el('div', { class: 'title-layout' },
        media.coverUrl
          ? el('img', { class: 'title-cover', src: media.coverUrl, alt: '' })
          : el('span', { class: 'title-cover is-empty', 'aria-hidden': 'true' }),
        el('div', { class: 'title-details' },
          el('h2', { class: 'title-name' }, media.title),
          media.titleNative && media.titleNative !== media.title
            ? el('p', { class: 'title-native' }, media.titleNative)
            : null,
          el('p', { class: 'title-facts' }, facts(media).join(' · ')),
          media.synopsis ? el('p', { class: 'title-synopsis' }, media.synopsis) : null,
          (media.genres || []).length
            ? el('div', { class: 'title-group' },
              el('h3', { class: 'title-group-title' }, 'Genres'),
              genreLinks)
            : null,
          (media.tags || []).length
            ? el('div', { class: 'title-group' },
              el('h3', { class: 'title-group-title' }, 'Tags'),
              tagLinks)
            : null,
          el('div', { class: 'title-actions' },
            addButton,
            el('a', { class: 'btn btn-quiet', href: '#/browse' }, 'Keep browsing'))))
    );
  }).catch((error) => {
    render(body, el('p', { class: 'account-danger-note' }, error.message || 'Could not load that title.'));
  });
}
