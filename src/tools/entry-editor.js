/**
 * Entry editor sheet: status, progress, score, notes, favourite.
 * A native <dialog> so Escape closes it and focus returns to the trigger.
 */

import { el, render, setStatus } from '../lib.js';
import { LIBRARY_STATUSES, STATUS_LABELS, removeEntry, saveEntry } from '../library.js';

function totalFor(entry) {
  if (entry.chapters != null) return entry.chapters;
  if (entry.episodes != null) return entry.episodes;
  return null;
}

export function openEntryEditor(entry, { onSaved, onStatus } = {}) {
  const total = totalFor(entry);
  const unit = entry.chapters != null ? 'chapters' : 'episodes';

  const statusSelect = el('select', { id: 'entry-editor-status' },
    ...LIBRARY_STATUSES.map((key) => el('option', { value: key }, STATUS_LABELS[key] || key)));
  statusSelect.value = entry.status || 'PLANNING';

  const progressInput = el('input', {
    type: 'number',
    id: 'entry-editor-progress',
    min: '0',
    max: total != null ? String(total) : '',
    step: '1',
    value: String(entry.progress || 0),
  });
  const scoreInput = el('input', {
    type: 'number',
    id: 'entry-editor-score',
    min: '0',
    max: '10',
    step: '0.1',
    value: entry.score == null ? '' : String(entry.score),
  });
  const notesInput = el('textarea', { id: 'entry-editor-notes', rows: '3', maxlength: '2000' });
  notesInput.value = entry.notes || '';

  const favouriteInput = el('input', { type: 'checkbox', id: 'entry-editor-favourite' });
  favouriteInput.checked = entry.favourite === true;

  const error = el('div', { class: 'status', role: 'alert', 'aria-live': 'assertive' });
  const saveButton = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save entry');
  const removeButton = el('button', { class: 'btn btn-danger', type: 'button' }, 'Remove from list');

  const form = el(
    'form',
    { class: 'auth-form auth-link-form' },
    el('div', { class: 'field auth-field' },
      el('label', { for: 'entry-editor-status' }, 'Status'),
      statusSelect),
    el('div', { class: 'field auth-field' },
      el('label', { for: 'entry-editor-progress' }, 'Progress' + (total != null ? ' (' + unit + ' of ' + total + ')' : '')),
      progressInput),
    el('div', { class: 'field auth-field' },
      el('label', { for: 'entry-editor-score' }, 'Your score (0-10)'),
      scoreInput),
    el('div', { class: 'field auth-field' },
      el('label', { for: 'entry-editor-notes' }, 'Notes'),
      notesInput),
    el('label', { class: 'check', for: 'entry-editor-favourite' },
      favouriteInput,
      el('span', {}, 'Favourite')),
    error,
    el('div', { class: 'entry-editor-actions' }, saveButton, removeButton)
  );

  const dialog = el(
    'dialog',
    { class: 'auth-dialog entry-editor', 'aria-labelledby': 'entry-editor-title' },
    el('div', { class: 'auth-dialog-head' },
      el('div', {},
        el('h2', { id: 'entry-editor-title', class: 'auth-dialog-title' }, entry.title || 'Entry'),
        el('p', { class: 'auth-dialog-subtitle' }, 'Track where you are with this title.')),
      el('button', { class: 'auth-dialog-close', type: 'button', 'aria-label': 'Close the editor' }, '×')),
    form
  );

  document.body.append(dialog);
  let lastTrigger = null;

  function returnFocus() {
    if (lastTrigger && document.contains(lastTrigger)) {
      lastTrigger.focus();
      return;
    }
    // The list is re-rendered after a save, so the trigger may be gone.
    const list = document.getElementById('my-list-entries');
    if (list) list.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
    dialog.remove();
    returnFocus();
  }

  dialog.querySelector('.auth-dialog-close').addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    returnFocus();
  });

  removeButton.addEventListener('click', async () => {
    removeButton.disabled = true;
    try {
      const next = await removeEntry({ id: entry.id, mediaId: entry.mediaId });
      close();
      if (onSaved) onSaved(next);
      if (onStatus) onStatus('Removed "' + entry.title + '" from your list.');
    } catch (removeError) {
      setStatus(error, removeError.message || 'Could not remove that title.', 'error');
      removeButton.disabled = false;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    try {
      const next = await saveEntry({
        id: entry.id,
        mediaId: entry.mediaId,
        media: entry,
        status: statusSelect.value,
        progress: Number(progressInput.value || 0),
        score: scoreInput.value === '' ? null : Number(scoreInput.value),
        notes: notesInput.value.trim() || null,
        favourite: favouriteInput.checked,
      });
      close();
      if (onSaved) onSaved(next);
      if (onStatus) onStatus('Saved "' + entry.title + '".');
    } catch (saveError) {
      setStatus(error, saveError.message || 'Could not save that entry.', 'error');
      saveButton.disabled = false;
    }
  });

  dialog.showModal();
  statusSelect.focus();
  return { close, setTrigger: (node) => { lastTrigger = node; } };
}
