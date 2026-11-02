/**
 * Anime Wrapped: fetch a public list profile and render a shareable summary.
 */

import { el, render, setStatus, copyText } from '../lib.js';
import { renderCard, summaryText } from './card-view.js';
import { getProvider, providers } from '../providers/index.js';

const STYLE_FILES = ['tool-card.css', 'tool-card-ui.css'];

function injectStyles() {
  for (const file of STYLE_FILES) {
    const id = 'style-' + file;
    if (document.getElementById(id)) continue;

    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = new URL('../../assets/' + file, import.meta.url).href;
    document.head.append(link);
  }
}

function emptyCard() {
  return el(
    'div',
    { class: 'taste-card taste-card--empty' },
    el('p', {}, 'Your Anime Wrapped will appear here after you enter a profile username.')
  );
}

export default {
  id: 'card',
  title: 'Anime Wrapped',
  blurb: 'A compact look at the anime you have logged on MyAnimeList or AniList.',

  mount(root) {
    injectStyles();

    const sourceLabel = el('label', { for: 'wrapped-source' }, 'Profile source');
    const sourceSelect = el(
      'select',
      {
        id: 'wrapped-source',
        name: 'source',
        'aria-describedby': 'wrapped-hint',
      },
      providers.map((provider) =>
        el('option', { value: provider.id }, provider.label)
      )
    );
    sourceSelect.value = 'mal';
    const usernameLabel = el('label', { for: 'wrapped-username' }, 'MyAnimeList username');
    const username = el('input', {
      type: 'text',
      id: 'wrapped-username',
      name: 'username',
      autocomplete: 'username',
      autocapitalize: 'none',
      spellcheck: 'false',
      maxlength: '32',
      placeholder: 'MyAnimeList username',
      required: true,
      'aria-describedby': 'wrapped-hint',
    });
    username.maxLength = 16;
    const submit = el('button', { class: 'btn', type: 'submit' }, 'Build my Wrapped');
    const status = el('div', {
      class: 'status',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    const stage = el('div', { class: 'card-stage', 'aria-live': 'polite' }, emptyCard());
    const actions = el('div', { class: 'card-actions', hidden: true });

    const form = el(
      'form',
      { class: 'wrapped-form' },
      el(
        'div',
        { class: 'field' },
          sourceLabel,
          sourceSelect,
          usernameLabel,
          el('div', { class: 'input-row' }, username, submit),
          el(
            'p',
            { class: 'hint', id: 'wrapped-hint' },
            'Public profile data is fetched on demand. Nothing is saved.'
        )
      ),
      status
    );

    render(
      root,
      el(
        'div',
        { class: 'tool-head' },
        el('h1', {}, 'Anime Wrapped'),
        el('p', {}, 'A compact look at the anime you have logged on MyAnimeList or AniList.')
      ),
      el('section', { class: 'panel', 'aria-label': 'Anime Wrapped generator' }, form),
      stage,
      actions
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const provider = getProvider(sourceSelect.value);
      if (!provider) {
        setStatus(status, 'Choose a supported profile source.', 'error');
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Building...';
      actions.hidden = true;
      render(
        stage,
        el(
          'div',
          { class: 'taste-card taste-card--empty', role: 'status' },
          'Loading your public ' + provider.label + ' profile...'
        )
      );
      setStatus(status, 'Fetching public profile data from ' + provider.label + '.', 'info');

      try {
        const profile = await provider.fetchProfile(username.value);
        render(stage, renderCard(profile));
        setStatus(status, '');
        const copyButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Copy summary');
        render(actions, copyButton);
        actions.hidden = false;
        copyButton.addEventListener('click', async () => {
          const copied = await copyText(summaryText(profile));
          setStatus(
            status,
            copied
              ? 'Summary copied to the clipboard.'
              : 'Could not copy the summary. Check clipboard permissions and try again.',
            copied ? 'info' : 'error'
          );
        });
      } catch (error) {
        render(stage, emptyCard());
        setStatus(
          status,
          error && error.message ? error.message : 'Could not build the card. Try again.',
          'error'
        );
      } finally {
        submit.disabled = false;
        submit.textContent = 'Build my Wrapped';
      }
    });

    sourceSelect.addEventListener('change', () => {
      const provider = getProvider(sourceSelect.value);
      if (!provider) return;
      username.placeholder = provider.placeholder;
      username.maxLength = provider.id === 'mal' ? 16 : 32;
      usernameLabel.textContent = provider.label === 'AniList'
        ? 'AniList username'
        : 'MyAnimeList username';
    });
  },
};
