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
  mobileBrand: document.getElementById('mobile-brand'),
  nav: document.getElementById('nav'),
  mobileNav: document.getElementById('mobile-nav'),
  navToggle: document.getElementById('nav-toggle'),
  navDialog: document.getElementById('mobile-nav-dialog'),
  navClose: document.getElementById('nav-close'),
  app: document.getElementById('app'),
  footer: document.getElementById('footer'),
};

let cleanupCurrent = null;
let mountToken = 0;
let bootstrapped = false;

/** Create an SVG element in the SVG namespace. */
function svg(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
}

/**
 * The brand mark: a globe drawn with one continuous stroke. It sits on the
 * sidebar, the mobile header, and rotates a step when the wordmark is
 * hovered, so the identity answers the pointer.
 */
function brandMark() {
  const icon = svg('svg', {
    class: 'brand-mark',
    viewBox: '0 0 24 24',
    width: '21',
    height: '21',
    fill: 'none',
    'aria-hidden': 'true',
  });
  icon.append(
    svg('circle', { cx: '12', cy: '12', r: '9.4', stroke: 'currentColor', 'stroke-width': '1.7' }),
    svg('ellipse', { cx: '12', cy: '12', rx: '4.4', ry: '9.4', stroke: 'currentColor', 'stroke-width': '1.3' }),
    svg('path', { d: 'M2.6 12h18.8', stroke: 'currentColor', 'stroke-width': '1.3' })
  );
  return icon;
}

/**
 * Tool icons: drawn for these three tools (a wrap card, a film frame, an
 * open book) rather than taken from a shared library look.
 */
const TOOL_ICONS = {
  card() {
    const icon = svg('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    icon.append(
      svg('rect', { x: '2.2', y: '2.6', width: '11.6', height: '10.8', rx: '1.6' }),
      svg('path', { d: 'M5.3 5.9h5.4M5.3 8.3h3.4' })
    );
    return icon;
  },
  film() {
    const icon = svg('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    icon.append(
      svg('rect', { x: '2.2', y: '3.6', width: '11.6', height: '8.8', rx: '1.6' }),
      svg('path', { d: 'M5.4 3.6v8.8M10.6 3.6v8.8' })
    );
    return icon;
  },
  book() {
    const icon = svg('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    icon.append(
      svg('path', { d: 'M8 4.4C6.6 3.5 4.7 3.4 3.2 3.5v9c1.5-.1 3.4 0 4.8.9 1.4-.9 3.3-1 4.8-.9v-9C11.3 3.4 9.4 3.5 8 4.4Z' }),
      svg('path', { d: 'M8 4.9v8.4' })
    );
    return icon;
  },
};

function iconFor(toolId) {
  if (toolId === 'card') return TOOL_ICONS.card();
  if (toolId === 'daily') return TOOL_ICONS.film();
  return TOOL_ICONS.book();
}

function renderBrand() {
  for (const brand of [dom.brand, dom.mobileBrand]) {
    render(brand, brandMark(), el('span', {}, site.name));
    brand.setAttribute('aria-label', site.name + ', home');
  }
}

function renderNav() {
  const links = () =>
    tools.map((tool) =>
      el(
        'a',
        { class: 'nav-link', href: '#/' + tool.id, dataset: { tool: tool.id } },
        iconFor(tool.id),
        el('span', {}, tool.label)
      )
    );

  render(dom.nav, links());
  render(dom.mobileNav, links());
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
      { class: 'footer-brand' },
      el('h2', {}, site.name),
      el('p', {}, site.tagline),
      el(
        'nav',
        { 'aria-label': 'AniGlobe tools' },
        ...toolLinks.reduce((all, link, index) => {
          if (index) all.push(' ');
          all.push(link);
          return all;
        }, [])
      ),
      el(
        'nav',
        { 'aria-label': 'Data sources' },
        ...sources.reduce((all, link, index) => {
          if (index) all.push(' ');
          all.push(link);
          return all;
        }, [])
      )
    ),
    el(
      'div',
      { class: 'footer-base' },
      el('span', {}, '© ' + new Date().getFullYear() + ' AniGlobe. An independent project.'),
      el('p', {}, 'MyAnimeList, Jikan-Edge, and AniList are not affiliated with it.')
    )
  );
}

function markActiveNav(toolId) {
  for (const nav of [dom.nav, dom.mobileNav]) {
    for (const link of nav.querySelectorAll('.nav-link')) {
      if (link.dataset.tool === toolId) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
}

function renderFailure(message) {
  render(
    dom.app,
    el(
      'div',
      { class: 'panel' },
      el(
        'div',
        { class: 'tool-head' },
        el('h1', {}, 'This tool did not load'),
        el('p', {}, message)
      ),
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

  // The tool region takes focus when the route changes, so keyboard and
  // screen-reader users land in the new tool. Not on the first mount: a
  // page that gets charged as it arrives is not what anyone opened.
  if (bootstrapped) {
    dom.app.focus({ preventScroll: true });
  }
  bootstrapped = true;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function onHashChange() {
  mountRoute();
}

function start() {
  renderBrand();
  renderNav();
  renderFooter();

  let dialogOpen = false;

  dom.navToggle.addEventListener('click', () => {
    dom.navDialog.showModal();
    dom.navToggle.setAttribute('aria-expanded', 'true');
    dom.navDialog.focus();
    dialogOpen = true;
  });
  dom.navClose.addEventListener('click', () => {
    dom.navDialog.close();
    dialogOpen = false;
  });
  dom.navDialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dom.navDialog.close();
      dialogOpen = false;
    }
  });
  // Also catch Escape on the document when the dialog is open
  document.addEventListener('keydown', (event) => {
    if (dialogOpen && event.key === 'Escape') {
      event.preventDefault();
      dom.navDialog.close();
      dialogOpen = false;
    }
  });
  dom.navDialog.addEventListener('close', () => {
    dom.navToggle.setAttribute('aria-expanded', 'false');
    dialogOpen = false;
  });
  dom.mobileNav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      dom.navDialog.close();
      dialogOpen = false;
    }
  });
  dom.navDialog.addEventListener('click', (event) => {
    if (event.target === dom.navDialog) {
      dom.navDialog.close();
      dialogOpen = false;
    }
  });

  if (!window.location.hash) {
    window.location.replace('#/' + defaultToolId);
  }

  window.addEventListener('hashchange', onHashChange);
  mountRoute();
}

start();
