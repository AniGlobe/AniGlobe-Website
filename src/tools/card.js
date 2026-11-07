import { el, render, setStatus, copyText, store } from '../lib.js';
import { exportNode, pngFileName } from '../export.js';
import { resolveMediaType } from '../domain/media.js';
import { renderCard, summaryText, globeStamp, sanitizeCardColors } from './card-view.js';
import { getProvider, providers } from '../providers/index.js';
import {
  deleteRemoteTemplate,
  getSession,
  onSessionChange,
  pullTemplates,
  pullWrappedPrefs,
  pushTemplate,
  pushWrappedPrefs,
} from '../auth.js';

const PREFERENCES_KEY = 'wrapped:preferences';
const TEMPLATES_KEY = 'wrapped:templates';
const MAX_TEMPLATES = 20;
const THEMES = [
  { value: 'atlas', name: 'Sea glass' },
  { value: 'coast', name: 'Open water' },
  { value: 'sakura', name: 'Sakura' },
  { value: 'ukiyo', name: 'Ukiyo' },
  { value: 'ember', name: 'Ember' },
  { value: 'night', name: 'Night map' },
];
const LAYOUTS = [
  { value: 'square', label: 'Square card' },
  { value: 'story', label: 'Story, 9:16' },
];
const SECTIONS = [
  { id: 'stats', label: 'Core stats', preference: 'showStats' },
  { id: 'status', label: 'List progress', preference: 'showStatus' },
  { id: 'insight', label: 'Taste notes', preference: 'showInsight' },
  { id: 'genres', label: 'Genre map', preference: 'showGenres' },
  { id: 'formats', label: 'Format mix', preference: 'showFormats' },
  { id: 'years', label: 'Release years', preference: 'showYears' },
  { id: 'distribution', label: 'Rating spread', preference: 'showDistribution' },
  { id: 'scored', label: 'Highest-rated titles', preference: 'showScored' },
  { id: 'favorites', label: 'Favorite titles', preference: 'showFavorites' },
];
const DEFAULT_SECTION_ORDER = SECTIONS.map((section) => section.id);

function normalizeSectionOrder(order) {
  const valid = Array.isArray(order) ? order.filter((id) => DEFAULT_SECTION_ORDER.includes(id)) : [];
  return [...new Set([...valid, ...DEFAULT_SECTION_ORDER])];
}

function savedPreferences() {
  const saved = store.get(PREFERENCES_KEY, {}) || {};
  return {
    source: saved.source === 'anilist' ? 'anilist' : 'mal',
    mediaType: saved.mediaType === 'manga' ? 'manga' : 'anime',
    theme: ['atlas', 'coast', 'night', 'sakura', 'ukiyo', 'ember'].includes(saved.theme) ? saved.theme : 'atlas',
    layout: saved.layout === 'story' ? 'story' : 'square',
    colors: sanitizeCardColors(saved.colors) || null,
    order: normalizeSectionOrder(saved.order),
    showStats: saved.showStats !== false,
    showStatus: saved.showStatus !== false,
    showGenres: saved.showGenres !== false,
    showFormats: saved.showFormats !== false,
    showYears: saved.showYears !== false,
    showFavorites: saved.showFavorites !== false,
    showScored: saved.showScored !== false,
    showDistribution: saved.showDistribution !== false,
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
 * Custom colors: six pickers layered over the active palette.
 * `overrides` holds only what the listener changed; empty means "use the palette".
 * The hex readouts always show the effective colour (palette or override),
 * resolved live off the rendered card.
 */
const COLOR_FIELDS = [
  { key: 'bg', label: 'Background', token: '--card-bg' },
  { key: 'soft', label: 'Panel fill', token: '--card-soft' },
  { key: 'ink', label: 'Text', token: '--card-ink' },
  { key: 'muted', label: 'Muted text', token: '--card-muted' },
  { key: 'bars', label: 'Bars and accents', token: '--card-accent' },
  { key: 'signal', label: 'Standout signal', token: '--card-signal' },
  { key: 'globe', label: 'Globe mark', token: '--card-globe' },
];

function colorPickersControl(cardRef, initial, onChange) {
  let overrides = sanitizeCardColors(initial) || {};
  const group = el('div', { class: 'color-fields' });

  const fields = COLOR_FIELDS.map((field) => {
    const input = el('input', {
      type: 'color',
      id: 'wrapped-color-' + field.key,
      name: 'color-' + field.key,
      'aria-label': field.label,
    });
    const hex = el('output', { class: 'color-hex', for: 'wrapped-color-' + field.key }, '');
    input.addEventListener('input', () => {
      overrides = { ...overrides, [field.key]: input.value };
      onChange(effectiveColors());
    });
    group.append(
      el('div', { class: 'color-field' },
        el('label', { for: 'wrapped-color-' + field.key }, field.label),
        hex,
        input)
    );
    return { field, input, hex };
  });

  const resetButton = el('button', { class: 'btn btn-outline btn-sm wrapped-reset-colors', type: 'button' }, 'Reset to palette');
  resetButton.addEventListener('click', () => {
    overrides = {};
    onChange(effectiveColors());
  });

  function effectiveColors() {
    return sanitizeCardColors(overrides);
  }

  function sync() {
    const card = cardRef();
    const resolved = card ? getComputedStyle(card) : null;
    for (const { field, input, hex } of fields) {
      const effective = overrides[field.key]
        || (resolved ? resolved.getPropertyValue(field.token).trim() : '#000000');
      input.value = /^#[0-9a-f]{6}$/i.test(effective) ? effective : '#000000';
      hex.textContent = input.value.toUpperCase();
    }
  }

  return {
    node: el('div', { class: 'color-fields-block' }, group, resetButton),
    get value() {
      return effectiveColors();
    },
    sync,
    set(next) {
      overrides = sanitizeCardColors(next) || {};
      sync();
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
  };
  if (busy) {
    attrs.role = 'status';
  }

  return el(
    'div',
    attrs,
    el('div', { class: 'export-card-body' },
      el('header', { class: 'export-card-header' },
        el('h2', { class: 'export-card-title' }, 'AniManga Wrapped'),
        globeStamp('sm')
      ),
      el('div', { class: 'export-identity' },
        el('p', { class: 'export-name', style: { color: 'var(--card-muted)', fontSize: 'var(--fs-body)' } }, 'Your card appears here'),
        el('p', { class: 'export-since' }, 'Enter a public MyAnimeList or AniList username to begin')
      ),
      el('div', { class: 'export-archetype', style: { marginTop: 'var(--s3)' } },
        el('h3', { class: 'export-archetype-label' }, 'What you\'ll see'),
        el('p', { class: 'export-archetype-blurb' }, 'Profile stats, list progress, ratings, genres, formats, release years, favorites, completed titles, and taste notes. MyAnimeList title details use a labeled sample of up to 16 titles.')
      ),
      el('footer', { class: 'export-card-footer' },
        el('span', {}, 'Profile data from MyAnimeList or AniList'),
        el('span', { class: 'export-card-footer-mark' }, 'ANIGLOBE')
      )
    )
  );
}

function checkOption(id, label, checked) {
  const input = el('input', { type: 'checkbox', id, name: id });
  input.checked = checked;
  return el('label', { class: 'check', for: id }, input, el('span', {}, label));
}

export default {
  id: 'card',
  title: 'AniManga Wrapped',
  blurb: 'A personal snapshot of your anime or manga list.',

  mount(root) {
    const preferences = savedPreferences();
    let currentProfile = null;
    let currentCard = null;
    let sectionOrder = preferences.order.slice();

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
    const colorPickers = colorPickersControl(() => currentCard, preferences.colors, () => {
      savePreferences();
      refreshCard();
    });
    const layoutPick = pickControl(
      'wrapped-layout',
      'layout',
      'Export format',
      LAYOUTS,
      preferences.layout
    );

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
    const actions = el('div', { class: 'card-actions wrapped-stage-actions', hidden: true });
    const cardStatus = el('div', {
      class: 'status',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    const openCardButton = el('button', { class: 'btn btn-outline wrapped-open-card', type: 'button' }, 'Open card studio');
    const closeButton = el('button', { class: 'wrapped-dialog-close', type: 'button', 'aria-label': 'Close the card studio' }, '×');

    const options = el(
      'fieldset',
      { class: 'wrapped-options' },
      el('legend', {}, 'Choose what appears on your card'),
      ...SECTIONS.map((section) =>
        checkOption('wrapped-' + section.id, section.label, preferences[section.preference])
      )
    );
    const sectionOrderList = el('ol', {
      class: 'wrapped-section-list',
      id: 'wrapped-section-order',
      'aria-label': 'Card section order',
    });
    const templateSelect = el(
      'select',
      { id: 'wrapped-template-select', name: 'template' },
      el('option', { value: '' }, 'Choose a saved template')
    );
    const templateName = el('input', {
      type: 'text',
      id: 'wrapped-template-name',
      maxlength: '32',
      placeholder: 'Template name',
      'aria-label': 'Template name',
    });
    const saveTemplateButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Save template');
    const deleteTemplateButton = el('button', { class: 'btn btn-outline', type: 'button', disabled: true }, 'Delete selected');
    const templateControls = el(
      'div',
      { class: 'wrapped-templates' },
      el('h3', { class: 'wrapped-subtitle' }, 'Saved templates'),
      el('p', { class: 'hint' }, 'Templates stay in this browser. Saving an existing name replaces it.'),
      templateSelect,
      el('div', { class: 'wrapped-template-actions' }, templateName, saveTemplateButton, deleteTemplateButton)
    );
    const editor = el(
      'section',
      { class: 'wrapped-editor', 'aria-labelledby': 'wrapped-editor-title' },
      el('h3', { id: 'wrapped-editor-title', class: 'wrapped-subtitle' }, 'Arrange your card'),
      el(
        'p',
        { class: 'hint' },
        'Drag a section to move it, or use the up and down buttons. Hidden sections stay out of the preview and export.'
      ),
      sectionOrderList,
      options
    );

    function studioGroup(title, ...children) {
      return el('div', { class: 'studio-group' }, el('h3', {}, title), ...children);
    }

    const dialog = el(
      'dialog',
      { class: 'wrapped-dialog', 'aria-labelledby': 'wrapped-dialog-title' },
      el(
        'div',
        { class: 'wrapped-dialog-head' },
        el('h2', { id: 'wrapped-dialog-title', class: 'wrapped-dialog-title' }, 'Your wrapped card'),
        closeButton
      ),
      el(
        'div',
        { class: 'wrapped-dialog-body' },
        el('div', { class: 'wrapped-dialog-stage' }, stage, actions, cardStatus),
        el(
          'aside',
          { class: 'wrapped-dialog-rail', 'aria-label': 'Card studio' },
          studioGroup('Palette', themePick.node),
          studioGroup('Colours', colorPickers.node),
          studioGroup('Export format', layoutPick.node),
          studioGroup('Arrange and show', editor),
          studioGroup('Saved templates', templateControls)
        )
      )
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
      openCardButton,
      status
    );

    render(
      root,
      el(
        'div',
        { class: 'wrapped-page' },
        el(
          'div',
          { class: 'tool-head wrapped-heading' },
          el('h1', {}, 'AniManga Wrapped'),
          el('p', {}, 'Turn your anime or manga list into a card worth sharing.')
        ),
        el('section', { class: 'panel wrapped-panel', 'aria-label': 'AniManga Wrapped generator' },
          el('h2', { class: 'panel-title' }, 'Create your wrap'),
          form
        ),
        dialog
      )
    );

    function renderSectionOrder() {
      render(
        sectionOrderList,
        sectionOrder.map((id, index) => {
          const section = SECTIONS.find((candidate) => candidate.id === id);
          return el(
            'li',
            { class: 'wrapped-section-item', dataset: { section: id }, draggable: 'true' },
            el('span', { class: 'wrapped-drag-hint', 'aria-hidden': 'true' }, 'Drag'),
            el('span', { class: 'wrapped-section-name' }, section.label),
            el(
              'div',
              { class: 'wrapped-section-controls' },
              el(
                'button',
                {
                  class: 'btn btn-outline btn-sm',
                  type: 'button',
                  dataset: { move: 'up', section: id },
                  disabled: index === 0,
                  'aria-label': 'Move ' + section.label + ' up',
                },
                'Move up'
              ),
              el(
                'button',
                {
                  class: 'btn btn-outline btn-sm',
                  type: 'button',
                  dataset: { move: 'down', section: id },
                  disabled: index === sectionOrder.length - 1,
                  'aria-label': 'Move ' + section.label + ' down',
                },
                'Move down'
              )
            )
          );
        })
      );
    }

    function currentOptions() {
      const options = {
        theme: themePick.value,
        layout: layoutPick.value,
        order: sectionOrder.slice(),
        colors: colorPickers.value,
      };
      for (const section of SECTIONS) {
        options[section.preference] = document.getElementById('wrapped-' + section.id).checked;
      }
      return options;
    }

    function readTemplates() {
      const saved = store.get(TEMPLATES_KEY, []);
      return Array.isArray(saved)
        ? saved.filter((template) => template && typeof template.name === 'string' && template.options)
        : [];
    }

    function refreshTemplateSelect(selectedName) {
      const templates = readTemplates();
      const selected = selectedName || templateSelect.value;
      render(
        templateSelect,
        el('option', { value: '' }, 'Choose a saved template'),
        ...templates.map((template) => el('option', { value: template.name }, template.name))
      );
      templateSelect.value = templates.some((template) => template.name === selected) ? selected : '';
      deleteTemplateButton.disabled = !templateSelect.value;
    }

    function applyTemplate(template) {
      const options = template.options;
      if (THEMES.some((entry) => entry.value === options.theme)) themePick.value = options.theme;
      layoutPick.value = options.layout === 'story' ? 'story' : 'square';
      sectionOrder = normalizeSectionOrder(options.order);
      for (const section of SECTIONS) {
        const input = document.getElementById('wrapped-' + section.id);
        input.checked = options[section.preference] !== false;
      }
      colorPickers.set(options.colors);
      renderSectionOrder();
      savePreferences();
      refreshCard();
      setStatus(cardStatus, 'Template "' + template.name + '" applied.', 'info');
    }

    function savePreferences() {
      const options = currentOptions();
      const saved = store.set(PREFERENCES_KEY, {
        source: sourcePick.value,
        mediaType: mediaPick.value,
        ...options,
      });
      if (!saved) setStatus(status, 'Could not save card settings in this browser.', 'error');
      else pushWrappedPrefs(options);
      return saved;
    }

    function refreshCard() {
      if (!currentProfile) return;
      currentCard = renderCard(currentProfile, currentOptions());
      render(stage, currentCard);
      colorPickers.sync();
    }

    let lastTrigger = openCardButton;

    function openDialog(trigger) {
      lastTrigger = trigger || openCardButton;
      if (!dialog.open) dialog.showModal();
      document.documentElement.classList.add('wrapped-dialog-open');
      colorPickers.sync();
      closeButton.focus();
    }

    function closeDialog() {
      if (dialog.open) dialog.close();
      document.documentElement.classList.remove('wrapped-dialog-open');
      if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
    }

    closeButton.addEventListener('click', closeDialog);
    openCardButton.addEventListener('click', () => openDialog(openCardButton));
    dialog.addEventListener('close', () => {
      document.documentElement.classList.remove('wrapped-dialog-open');
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog();
    });

    renderSectionOrder();
    refreshTemplateSelect();

    /**
     * Pull server state into the local store on sign-in. Last writer wins per
     * type: server prefs replace local prefs when the server has some (the
     * account is the shared truth); local prefs migrate up when it does not
     * (first sign-in). Templates merge by name both ways.
     */
    async function syncFromServer() {
      const sessionUser = getSession() && getSession().user;
      if (!sessionUser) return;

      const serverPrefs = await pullWrappedPrefs();
      if (serverPrefs) {
        const next = sanitizeCardColors(serverPrefs.colors) ? serverPrefs : null;
        if (next) {
          themePick.value = ['atlas', 'coast', 'night', 'sakura', 'ukiyo', 'ember'].includes(next.theme) ? next.theme : 'atlas';
          layoutPick.value = next.layout === 'story' ? 'story' : 'square';
          sectionOrder = normalizeSectionOrder(next.order);
          for (const section of SECTIONS) {
            const input = document.getElementById('wrapped-' + section.id);
            if (input) input.checked = next[section.preference] !== false;
          }
          colorPickers.set(next.colors);
          renderSectionOrder();
          store.set(PREFERENCES_KEY, {
            source: sourcePick.value,
            mediaType: mediaPick.value,
            ...currentOptions(),
          });
          refreshCard();
        }
      } else {
        await pushWrappedPrefs(currentOptions());
      }

      const remoteTemplates = await pullTemplates();
      const localTemplates = readTemplates();
      const localByName = new Map(localTemplates.map((template) => [template.name, template]));
      const merged = [];
      for (const remote of remoteTemplates) {
        if (localByName.has(remote.name)) {
          merged.push(localByName.get(remote.name));
        } else {
          merged.push({ name: remote.name, options: remote.payload });
        }
      }
      for (const local of localTemplates) {
        if (!remoteTemplates.some((template) => template.name === local.name)) {
          merged.push(local);
          await pushTemplate(local.name, local.options);
        }
      }
      store.set(TEMPLATES_KEY, merged);
      refreshTemplateSelect();
    }

    const offSessionChange = onSessionChange((user) => {
      if (user) syncFromServer();
    });
    if (getSession()) syncFromServer();

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
        const profile = await provider.fetchProfile(username.value, media.id, (message) => {
          setStatus(status, message, 'info');
        });
        currentProfile = profile;
        refreshCard();
        setStatus(status, 'Profile loaded from ' + provider.label + '.', 'info');
        if (profile.dataWarning) {
          setStatus(cardStatus, profile.dataWarning, 'warn');
        } else {
          setStatus(cardStatus, 'Your card is ready. Customize it in the studio, then save it.', 'info');
        }
        openDialog(submit);
        const copyButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Copy summary');
        const saveButton = el(
          'button',
          { class: 'btn btn-outline wrapped-save-button', type: 'button' },
          layoutPick.value === 'story' ? 'Save story PNG' : 'Save square PNG'
        );
        render(actions, copyButton, saveButton);
        actions.hidden = false;
        copyButton.addEventListener('click', async () => {
          const copied = await copyText(summaryText(profile, currentOptions()));
          setStatus(
            cardStatus,
            copied ? 'Summary copied to the clipboard.' : 'Could not copy the summary. Check clipboard permissions and try again.',
            copied ? 'info' : 'error'
          );
        });
        saveButton.addEventListener('click', async () => {
          saveButton.disabled = true;
          setStatus(cardStatus, 'Preparing your image...', 'info');
          try {
            const fileName = pngFileName(
              layoutPick.value === 'story' ? 'aniglobe-story' : 'aniglobe',
              media.id + '-wrapped-' + profile.name
            );
            const background = getComputedStyle(currentCard).getPropertyValue('--card-bg').trim();
            currentCard.dataset.exporting = 'true';
            try {
              await exportNode(currentCard, fileName, {
                background,
                renderWidth: layoutPick.value === 'story' ? 540 : 720,
                width: layoutPick.value === 'story' ? 540 : 720,
                height: layoutPick.value === 'story' ? 960 : 720,
              });
            } finally {
              delete currentCard.dataset.exporting;
            }
            setStatus(cardStatus, 'Your card image has been saved.', 'info');
          } catch (error) {
            setStatus(
              cardStatus,
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
    layoutPick.node.addEventListener('change', () => {
      savePreferences();
      refreshCard();
      const saveButton = actions.querySelector('.wrapped-save-button');
      if (saveButton) saveButton.textContent = layoutPick.value === 'story' ? 'Save story PNG' : 'Save square PNG';
    });
    options.addEventListener('change', () => {
      savePreferences();
      refreshCard();
    });

    sectionOrderList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-move]');
      if (!button) return;
      const currentIndex = sectionOrder.indexOf(button.dataset.section);
      const nextIndex = currentIndex + (button.dataset.move === 'up' ? -1 : 1);
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sectionOrder.length) return;
      const [moved] = sectionOrder.splice(currentIndex, 1);
      sectionOrder.splice(nextIndex, 0, moved);
      renderSectionOrder();
      savePreferences();
      refreshCard();
      setStatus(cardStatus, SECTIONS.find((section) => section.id === moved).label + ' moved.', 'info');
    });

    let draggedSectionId = null;
    sectionOrderList.addEventListener('dragstart', (event) => {
      const item = event.target.closest('.wrapped-section-item');
      if (!item || !event.dataTransfer) return;
      draggedSectionId = item.dataset.section;
      item.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedSectionId);
    });
    sectionOrderList.addEventListener('dragover', (event) => {
      if (draggedSectionId) event.preventDefault();
    });
    sectionOrderList.addEventListener('drop', (event) => {
      if (!draggedSectionId) return;
      const target = event.target.closest('.wrapped-section-item');
      if (!target || target.dataset.section === draggedSectionId) return;
      event.preventDefault();
      const fromIndex = sectionOrder.indexOf(draggedSectionId);
      const toIndex = sectionOrder.indexOf(target.dataset.section);
      if (fromIndex < 0 || toIndex < 0) return;
      const [moved] = sectionOrder.splice(fromIndex, 1);
      sectionOrder.splice(toIndex, 0, moved);
      draggedSectionId = null;
      renderSectionOrder();
      savePreferences();
      refreshCard();
      setStatus(cardStatus, SECTIONS.find((section) => section.id === moved).label + ' moved.', 'info');
    });
    sectionOrderList.addEventListener('dragend', () => {
      draggedSectionId = null;
      sectionOrderList.querySelectorAll('.is-dragging').forEach((item) => item.classList.remove('is-dragging'));
    });

    saveTemplateButton.addEventListener('click', () => {
      const name = templateName.value.trim();
      if (!name) {
        setStatus(cardStatus, 'Enter a name for this template.', 'error');
        templateName.focus();
        return;
      }

      const templates = readTemplates();
      const existingIndex = templates.findIndex(
        (template) => template.name.toLowerCase() === name.toLowerCase()
      );
      if (existingIndex < 0 && templates.length >= MAX_TEMPLATES) {
        setStatus(cardStatus, 'This browser already has 20 saved templates. Delete one to save another.', 'error');
        return;
      }
      const template = { name, options: currentOptions() };
      if (existingIndex < 0) templates.push(template);
      else templates[existingIndex] = template;
      if (!store.set(TEMPLATES_KEY, templates)) {
        setStatus(cardStatus, 'Could not save this template in browser storage.', 'error');
        return;
      }
      refreshTemplateSelect(name);
      pushTemplate(name, template.options);
      setStatus(cardStatus, 'Template "' + name + '" saved in this browser.', 'info');
    });
    templateSelect.addEventListener('change', () => {
      const template = readTemplates().find((item) => item.name === templateSelect.value);
      if (template) applyTemplate(template);
      else deleteTemplateButton.disabled = true;
    });
    deleteTemplateButton.addEventListener('click', () => {
      const name = templateSelect.value;
      if (!name) return;
      const templates = readTemplates().filter((template) => template.name !== name);
      if (!store.set(TEMPLATES_KEY, templates)) {
        setStatus(cardStatus, 'Could not delete this template from browser storage.', 'error');
        return;
      }
      refreshTemplateSelect('');
      deleteRemoteTemplate(name);
      setStatus(cardStatus, 'Template "' + name + '" deleted.', 'info');
    });
    updateUsernameField();
  },
};
