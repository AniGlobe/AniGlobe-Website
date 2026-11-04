import { el, render, setStatus, copyText, store } from '../lib.js';
import { exportNode, pngFileName } from '../export.js';
import { resolveMediaType } from '../domain/media.js';
import { renderCard, summaryText } from './card-view.js';
import { getProvider, providers } from '../providers/index.js';

const STYLE_FILES = ['tool-card.css', 'tool-card-ui.css'];
const PREFERENCES_KEY = 'wrapped:preferences';
const THEMES = [
  { value: 'atlas', name: 'Sea glass' },
  { value: 'coast', name: 'Open water' },
  { value: 'night', name: 'Night map' },
];

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

/**
 * A segmented radio group exposed with the old select-style interface:
 * `control.node` for rendering and events, `control.value` to read/write.
 */
function pickControl(idPrefix, name, labelText, options, preferred) {
  const groupLabel = el('span', { class: 'pick-label', id: idPrefix + '-label' }, labelText);
  const group = el('div', {
    class: 'pick',
    role: 'radiogroup',
    'aria-labelledby': idPrefix + '-label',
  });

  for (const option of options) {
    const input = el('input', {
      type: 'radio',
      id: idPrefix + '-' + option.value,
      name,
      value: option.value,
    });
    input.checked = option.value === preferred;
    group.append(el('label', { for: input.id }, input, el('span', {}, option.label)));
  }

  return {
    node: el('div', { class: 'field' }, groupLabel, group),
    get value() {
      const checked = group.querySelector('input:checked');
      return checked ? checked.value : options[0].value;
    },
    set value(next) {
      const input = group.querySelector('input[value="' + next + '"]');
      if (input) input.checked = true;
    },
  };
}

/** The card palettes as swatches. Same interface as `pickControl`. */
function swatchControl(preferred) {
  const groupLabel = el('span', { class: 'pick-label', id: 'wrapped-theme-label' }, 'Card palette');
  const group = el('div', {
    class: 'swatches',
    role: 'radiogroup',
    'aria-labelledby': 'wrapped-theme-label',
  });

  for (const theme of THEMES) {
    const input = el('input', {
      type: 'radio',
      id: 'wrapped-theme-' + theme.value,
      name: 'theme',
      value: theme.value,
    });
    input.checked = theme.value === preferred;
    group.append(
      el(
        'label',
        { class: 'swatch', for: input.id },
        input,
        el('span', { class: 'swatch-dot' }),
        el('span', { class: 'swatch-name' }, theme.name)
      )
    );
  }

  return {
    node: el('div', { class: 'field' }, groupLabel, group),
    get value() {
      const checked = group.querySelector('input:checked');
      return checked ? checked.value : THEMES[0].value;
    },
    set value(next) {
      const input = group.querySelector('input[value="' + next + '"]');
      if (input) input.checked = true;
    },
  };
}

/**
 * The empty stage: a clean slot with honest placeholder and one sentence.
 * `busy` marks it as the loading state while a profile is fetched.
 */
function slotsCard(message, busy) {
  const attrs = {
    class: 'export-card export-card--empty fade-in-up' + (busy ? ' export-card--loading' : ''),
    style: { '--card-bg': '#111111' },
  };
  if (busy) {
    attrs.role = 'status';
  }

  return el(
    'div',
    attrs,
    el('div', { class: 'export-card-body' },
      el('header', { class: 'export-card-header' },
        el('h2', { class: 'export-card-title slide-in-left' }, 'AniManga Wrapped'),
        globeStamp('sm')
      ),
      el('div', { class: 'export-identity' },
        el('p', { class: 'export-name fade-in-up', style: { color: 'var(--faint)', fontSize: 'var(--fs-body)' } }, 'Your card appears here'),
        el('p', { class: 'export-since fade-in-up', style: { animationDelay: '60ms' } }, 'Enter a public MyAnimeList or AniList username to begin')
      ),
      el('div', { class: 'export-archetype fade-in-up', style: { marginTop: 'var(--s3)', animationDelay: '120ms' } },
        el('h3', { class: 'export-archetype-label slide-in-left' }, 'What you\'ll see'),
        el('p', { class: 'export-archetype-blurb' }, 'Titles, episodes, watch time, mean score, frequent genres, top completed titles, favorites, and a standout rating: all in a single shareable card.')
      ),
      el('footer', { class: 'export-card-footer fade-in-up', style: { animationDelay: '180ms' } },
        el('span', {}, 'Profile data from MyAnimeList or AniList'),
        el('span', { class: 'export-footer-mark' }, 'AniGlobe')
      )
    )
  );
}

function checkOption(id, label, checked) {
  const input = el('input', { type: 'checkbox', id, name: id });
  input.checked = checked;
  return el('label', { class: 'check', for: id }, input, el('span', {}, label));
}

function globeStamp(size = 'md') {
  const cls = 'globe-stamp';
  return el('div', { class: cls + (size !== 'md' ? ' ' + cls + '-' + size : ''), 'aria-hidden': 'true' });
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

    const sourcePick = pickControl(
      'wrapped-source',
      'source',
      'List service',
      providers.map((provider) => ({ value: provider.id, label: provider.shortLabel || provider.label })),
      preferences.source
    );
    const mediaPick = pickControl(
      'wrapped-media',
      'media',
      'Make a wrap for',
      ['anime', 'manga'].map((type) => ({ value: type, label: resolveMediaType(type).label })),
      preferences.mediaType
    );
    const themePick = swatchControl(preferences.theme);

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
    const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Build my wrap');
    const status = el('div', {
      class: 'status',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    const stage = el(
      'div',
      { class: 'card-stage', 'aria-live': 'polite' },
      slotsCard('Your wrap will take shape here. Enter a public profile to begin.')
    );
    const actions = el('div', { class: 'card-actions', hidden: true });

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
      sourcePick.node,
      mediaPick.node,
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
        el('div', { class: 'wrapped-settings' }, themePick.node, options)
      ),
      status
    );

    const heroStamp = globeStamp('xl');
    heroStamp.classList.add('fade-in-up');

    render(
      root,
      el(
        'div',
        { class: 'wrapped-page' },
        el(
          'div',
          { class: 'tool-head wrapped-heading', style: { marginBottom: 'var(--s6)' } },
          el('div', { class: 'flex items-center justify-between gap-3', style: { marginBottom: 'var(--s3)', paddingInline: 'var(--s4)' } }, [
            el('h1', { class: 'slide-in-left', style: { paddingLeft: 'var(--s2)' } }, 'AniManga Wrapped'),
            heroStamp,
            el('div', { class: 'hero-accent' })
          ]),
          el('p', { class: 'fade-in-up' }, 'Turn your anime or manga list into a card worth sharing.')
        ),
        el('section', { class: 'panel wrapped-panel fade-in-up', 'aria-label': 'AniManga Wrapped generator', style: { animationDelay: '60ms' } },
      el('div', { class: 'flex items-center justify-between gap-2', style: { marginBottom: 'var(--s3)' } },
        el('h2', { class: 'slide-in-left', style: { fontSize: 'var(--fs-section)', fontWeight: 600, letterSpacing: '-0.01em' } }, 'Create your wrap'),
        globeStamp('md')
      ),
      form
    ),
        el(
          'aside',
          { class: 'wrapped-preview fade-in-up', 'aria-labelledby': 'wrapped-preview-title', style: { animationDelay: '120ms' } },
          el('div', { class: 'flex items-center justify-between gap-2', style: { marginBottom: 'var(--s3)' } },
            el('h2', { id: 'wrapped-preview-title', class: 'slide-in-left', style: { fontSize: 'var(--fs-section)', fontWeight: 600, letterSpacing: '-0.01em' } }, 'Your wrapped card'),
            globeStamp('md')
          ),
          stage,
          actions
        )
      )
    );

    function currentOptions() {
      return {
        theme: themePick.value,
        showGenres: document.getElementById('wrapped-genres').checked,
        showFavorites: document.getElementById('wrapped-favorites').checked,
        showScored: document.getElementById('wrapped-scored').checked,
        showInsight: document.getElementById('wrapped-insight').checked,
      };
    }

    function savePreferences() {
      store.set(PREFERENCES_KEY, {
        source: sourcePick.value,
        mediaType: mediaPick.value,
        ...currentOptions(),
      });
    }

    function refreshCard() {
      if (!currentProfile) return;
      currentCard = renderCard(currentProfile, currentOptions());
      render(stage, currentCard);
    }

    function updateUsernameField() {
      const provider = getProvider(sourcePick.value);
      if (!provider) return;
      const media = resolveMediaType(mediaPick.value);
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
      const provider = getProvider(sourcePick.value);
      const media = resolveMediaType(mediaPick.value);
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
        slotsCard('Loading your public ' + provider.label + ' ' + media.label.toLowerCase() + ' profile...', true)
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
            const background = getComputedStyle(currentCard).getPropertyValue('--card-bg').trim();
            await exportNode(currentCard, fileName, { background });
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
        render(stage, slotsCard('Your wrap will take shape here. Enter a public profile to begin.'));
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

    [sourcePick.node, mediaPick.node].forEach((control) => {
      control.addEventListener('change', () => {
        updateUsernameField();
        savePreferences();
      });
    });
    themePick.node.addEventListener('change', () => {
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
