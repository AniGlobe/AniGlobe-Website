import { el, render, setStatus, copyText, store } from '../lib.js';
import { exportNode, pngFileName } from '../export.js';
import { resolveMediaType } from '../domain/media.js';
import { renderCard, summaryText } from './card-view.js';
import { getProvider, providers } from '../providers/index.js';

const STYLE_FILES = ['tool-card.css', 'tool-card-ui.css'];
const PREFERENCES_KEY = 'wrapped:preferences';
const CARD_BACKGROUNDS = {
  atlas: '#f4ecd8',
  coast: '#e5f1ed',
  night: '#183b3a',
};

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

function savedPreferences() {
  const saved = store.get(PREFERENCES_KEY, {}) || {};
  return {
    source: saved.source === 'anilist' ? 'anilist' : 'mal',
    mediaType: saved.mediaType === 'manga' ? 'manga' : 'anime',
    theme: ['atlas', 'coast', 'night'].includes(saved.theme) ? saved.theme : 'atlas',
    showGenres: saved.showGenres !== false,
    showFavorites: saved.showFavorites !== false,
    showScored: saved.showScored !== false,
    showInsight: saved.showInsight !== false,
  };
}

function emptyCard() {
  return el(
    'div',
    { class: 'taste-card taste-card--empty' },
    el('p', {}, 'Your wrapped card will appear here after you enter a public profile.')
  );
}

function checkOption(id, label, checked) {
  const input = el('input', { type: 'checkbox', id, name: id });
  input.checked = checked;
  return el('label', { class: 'wrapped-check', for: id }, input, el('span', {}, label));
}

export default {
  id: 'card',
  title: 'AniManga Wrapped',
  blurb: 'A personal snapshot of your anime or manga list.',

  mount(root) {
    injectStyles();
    const preferences = savedPreferences();
    let currentProfile = null;
    let currentCard = null;
    const sourceLabel = el('label', { for: 'wrapped-source' }, 'List service');
    const sourceSelect = el(
      'select',
      { id: 'wrapped-source', name: 'source', 'aria-describedby': 'wrapped-hint' },
      providers.map((provider) => el('option', { value: provider.id }, provider.label))
    );
    sourceSelect.value = preferences.source;
    const mediaLabel = el('label', { for: 'wrapped-media' }, 'Make a wrap for');
    const mediaSelect = el(
      'select',
      { id: 'wrapped-media', name: 'media', 'aria-describedby': 'wrapped-hint' },
      ['anime', 'manga'].map((type) =>
        el('option', { value: type }, resolveMediaType(type).label)
      )
    );
    mediaSelect.value = preferences.mediaType;

    const usernameLabel = el('label', { for: 'wrapped-username' }, 'Profile username');
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
    const submit = el('button', { class: 'btn', type: 'submit' }, 'Build my wrap');
    const status = el('div', {
      class: 'status',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    const stage = el('div', { class: 'card-stage', 'aria-live': 'polite' }, emptyCard());
    const actions = el('div', { class: 'card-actions', hidden: true });

    const themeLabel = el('label', { for: 'wrapped-theme' }, 'Card palette');
    const themeSelect = el(
      'select',
      { id: 'wrapped-theme', name: 'theme' },
      [
        ['atlas', 'Atlas paper'],
        ['coast', 'Coastal chart'],
        ['night', 'Night voyage'],
      ].map(([value, label]) => el('option', { value }, label))
    );
    themeSelect.value = preferences.theme;
    const options = el(
      'fieldset',
      { class: 'wrapped-options' },
      el('legend', {}, 'Choose what appears on your card'),
      checkOption('wrapped-genres', 'Genre map', preferences.showGenres),
      checkOption('wrapped-favorites', 'Favorite titles', preferences.showFavorites),
      checkOption('wrapped-scored', 'Highest-rated titles', preferences.showScored),
      checkOption('wrapped-insight', 'Taste notes', preferences.showInsight)
    );
    const form = el(
      'form',
      { class: 'wrapped-form' },
      el(
        'div',
        { class: 'wrapped-form-grid' },
        el('div', { class: 'field' }, sourceLabel, sourceSelect),
        el('div', { class: 'field' }, mediaLabel, mediaSelect)
      ),
      el(
        'div',
        { class: 'field wrapped-username-field' },
        usernameLabel,
        el('div', { class: 'input-row' }, username, submit),
        el(
          'p',
          { class: 'hint', id: 'wrapped-hint' },
          'Public profile data loads when requested. AniGlobe does not save your profile.'
        )
      ),
      el(
        'details',
        { class: 'wrapped-customize' },
        el('summary', {}, 'Card settings'),
        el('div', { class: 'wrapped-settings' }, el('div', { class: 'field' }, themeLabel, themeSelect), options)
      ),
      status
    );

    render(
      root,
      el(
        'div',
        { class: 'tool-head wrapped-heading' },
        el('p', { class: 'tool-kicker' }, 'A snapshot from your side of the map'),
        el('h1', {}, 'AniManga Wrapped'),
        el('p', {}, 'Pick a list, add a username, and make the card feel like yours.')
      ),
      el('section', { class: 'panel wrapped-panel', 'aria-label': 'AniManga Wrapped generator' }, form),
      stage,
      actions
    );

    function currentOptions() {
      return {
        theme: themeSelect.value,
        showGenres: document.getElementById('wrapped-genres').checked,
        showFavorites: document.getElementById('wrapped-favorites').checked,
        showScored: document.getElementById('wrapped-scored').checked,
        showInsight: document.getElementById('wrapped-insight').checked,
      };
    }

    function savePreferences() {
      const current = currentOptions();
      store.set(PREFERENCES_KEY, {
        source: sourceSelect.value,
        mediaType: mediaSelect.value,
        ...current,
      });
    }

    function refreshCard() {
      if (!currentProfile) return;
      currentCard = renderCard(currentProfile, currentOptions());
      render(stage, currentCard);
    }

    function updateUsernameField() {
      const provider = getProvider(sourceSelect.value);
      if (!provider) return;
      const media = resolveMediaType(mediaSelect.value);
      username.placeholder = provider.id === 'mal'
        ? 'MyAnimeList username'
        : 'AniList username';
      username.maxLength = provider.id === 'mal' ? 16 : 32;
      usernameLabel.textContent = provider.label + ' username';
      username.autocomplete = 'username';
      submit.textContent = 'Build my ' + media.label.toLowerCase() + ' wrap';
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const provider = getProvider(sourceSelect.value);
      const media = resolveMediaType(mediaSelect.value);
      if (!provider) {
        setStatus(status, 'Choose a supported profile source.', 'error');
        return;
      }

      savePreferences();
      currentProfile = null;
      currentCard = null;
      submit.disabled = true;
      submit.textContent = 'Building your wrap...';
      actions.hidden = true;
      render(
        stage,
        el(
          'div',
          { class: 'taste-card taste-card--empty', role: 'status' },
          'Loading your public ' + provider.label + ' ' + media.label.toLowerCase() + ' profile...'
        )
      );
      setStatus(status, 'Fetching public profile data from ' + provider.label + '.', 'info');

      try {
        const profile = await provider.fetchProfile(username.value, media.id);
        currentProfile = profile;
        refreshCard();
        setStatus(status, '');
        const copyButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Copy summary');
        const saveButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Save card as PNG');
        render(actions, copyButton, saveButton);
        actions.hidden = false;
        copyButton.addEventListener('click', async () => {
          const copied = await copyText(summaryText(profile, currentOptions()));
          setStatus(
            status,
            copied ? 'Summary copied to the clipboard.' : 'Could not copy the summary. Check clipboard permissions and try again.',
            copied ? 'info' : 'error'
          );
        });
        saveButton.addEventListener('click', async () => {
          saveButton.disabled = true;
          setStatus(status, 'Preparing your image...', 'info');
          try {
            const fileName = pngFileName(
              'aniglobe',
              media.id + '-wrapped-' + profile.name
            );
            await exportNode(currentCard, fileName, { background: CARD_BACKGROUNDS[themeSelect.value] });
            setStatus(status, 'Your card image has been saved.', 'info');
          } catch (error) {
            setStatus(
              status,
              error && error.message ? error.message : 'Could not save the card image. Try again.',
              'error'
            );
          } finally {
            saveButton.disabled = false;
          }
        });
      } catch (error) {
        render(stage, emptyCard());
        setStatus(
          status,
          error && error.message ? error.message : 'Could not build the wrap. Try again.',
          'error'
        );
      } finally {
        submit.disabled = false;
        updateUsernameField();
      }
    });

    [sourceSelect, mediaSelect].forEach((control) => {
      control.addEventListener('change', () => {
        updateUsernameField();
        savePreferences();
      });
    });
    themeSelect.addEventListener('change', () => {
      savePreferences();
      refreshCard();
    });
    options.addEventListener('change', () => {
      savePreferences();
      refreshCard();
    });
    updateUsernameField();
  },
};
