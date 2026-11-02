/**
 * Shell bootstrap and hash router.
 *
 * Reads the tool registry from config, renders the chrome, and mounts one
 * tool at a time. A tool's mount() may return a cleanup function; the router
 * calls it before mounting the next one so listeners and timers do not pile up.
 */

import { site, tools, resolveToolId, defaultToolId } from './config.js';
import { el, render } from './lib.js';

const dom = {
  brand: document.getElementById('brand'),
  nav: document.getElementById('nav'),
  app: document.getElementById('app'),
  footer: document.getElementById('footer'),
};

let cleanupCurrent = null;
let mountToken = 0;

function renderBrand() {
  render(
    dom.brand,
    el('span', { class: 'brand-globe', 'aria-hidden': 'true' }),
    el('span', {}, site.name)
  );
  dom.brand.setAttribute('aria-label', site.name + ', home');
}

function renderNav() {
  render(
    dom.nav,
    tools.map((tool) =>
      el(
        'a',
        { class: 'nav-link', href: '#/' + tool.id, dataset: { tool: tool.id } },
        tool.label
      )
    )
  );
}

function renderFooter() {
  const toolLinks = tools.map((tool) =>
    el('a', { href: '#/' + tool.id }, tool.label)
  );
  const sources = [
    el('a', { href: 'https://myanimelist.net', rel: 'noopener noreferrer', target: '_blank' }, 'MyAnimeList'),
    el('a', { href: 'https://jikan.lucashdo.com/', rel: 'noopener noreferrer', target: '_blank' }, 'Jikan-Edge'),
    el('a', { href: 'https://anilist.co', rel: 'noopener noreferrer', target: '_blank' }, 'AniList'),
  ];

  render(
    dom.footer,
    el(
      'div',
      { class: 'footer-main' },
      el(
        'section',
        { class: 'footer-brand', 'aria-labelledby': 'footer-name' },
        el('h2', { id: 'footer-name' }, site.name),
        el('p', {}, site.tagline),
        site.support
          ? el('a', { href: site.support, rel: 'noopener noreferrer', target: '_blank' }, 'Support AniGlobe')
          : null
      ),
      el(
        'nav',
        { class: 'footer-links', 'aria-label': 'Footer links' },
        el('div', {}, el('h3', {}, 'Tools'), ...toolLinks),
        el('div', {}, el('h3', {}, 'Data sources'), ...sources)
      )
    ),
    el(
      'div',
      { class: 'footer-base' },
      el('span', {}, '© ' + new Date().getFullYear() + ' AniGlobe'),
      el('p', {}, 'AniGlobe is an independent project. MyAnimeList, Jikan-Edge, and AniList are not affiliated with it.')
    )
  );
}

function markActiveNav(toolId) {
  for (const link of dom.nav.querySelectorAll('.nav-link')) {
    if (link.dataset.tool === toolId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function renderFailure(message) {
  render(
    dom.app,
    el(
      'div',
      { class: 'panel' },
      el('div', { class: 'tool-head' }, el('h1', {}, 'This tool did not load')),
      el('p', {}, message),
      el(
        'p',
        { style: { marginTop: '16px' } },
        el('a', { class: 'btn', href: '#/' + defaultToolId }, 'Back to AniManga Wrapped')
      )
    )
  );
}

async function mountRoute() {
  const toolId = resolveToolId(window.location.hash);
  const entry = tools.find((tool) => tool.id === toolId) || tools[0];
  const token = ++mountToken;

  markActiveNav(entry.id);

  if (typeof cleanupCurrent === 'function') {
    try {
      cleanupCurrent();
    } catch {
      /* a broken cleanup must not block navigation */
    }
  }
  cleanupCurrent = null;

  let mod;
  try {
    mod = await entry.load();
  } catch {
    if (token === mountToken) {
      renderFailure('The page for ' + entry.label + ' could not be fetched. Check your connection and reload.');
    }
    return;
  }

  if (token !== mountToken) return;

  const tool = mod && mod.default;
  if (!tool || typeof tool.mount !== 'function') {
    renderFailure('The module for ' + entry.label + ' is missing a mount() export.');
    return;
  }

  document.title = entry.label + ' | ' + site.name;
  render(dom.app);

  try {
    const result = await tool.mount(dom.app, entry);
    if (token === mountToken) cleanupCurrent = typeof result === 'function' ? result : null;
  } catch (error) {
    if (token !== mountToken) return;
    const message = (error && error.message) || 'Unexpected error while rendering.';
    renderFailure(message);
  }

  dom.app.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function onHashChange() {
  mountRoute();
}

function start() {
  renderBrand();
  renderNav();
  renderFooter();

  if (!window.location.hash) {
    window.location.replace('#/' + defaultToolId);
  }

  window.addEventListener('hashchange', onHashChange);
  mountRoute();
}

start();
