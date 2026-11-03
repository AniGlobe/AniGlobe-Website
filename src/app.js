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
  topbarBrand: document.querySelector('.topbar-brand'),
  sidebar: document.getElementById('site-sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  nav: document.getElementById('nav'),
  app: document.getElementById('app'),
  footer: document.getElementById('footer'),
};

let cleanupCurrent = null;
let mountToken = 0;
let bootstrapped = false;

function renderBrand() {
  // Topbar brand already in HTML; ensure aria
  if (dom.topbarBrand) {
    dom.topbarBrand.setAttribute('aria-label', site.name + ', home');
  }
}

function renderNav() {
  const links = () =>
    tools.map((tool) =>
      el(
        'a',
        { class: 'nav-link', href: '#/' + tool.id, dataset: { tool: tool.id } },
        el('span', {}, tool.label)
      )
    );

  render(dom.nav, links());
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
  // Mark active in sidebar
  for (const link of dom.nav.querySelectorAll('.nav-link')) {
    if (link.dataset.tool === toolId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  // Mark active in topbar (if present)
  for (const link of document.querySelectorAll('.topbar-link')) {
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
      el(
        'div',
        { class: 'tool-head' },
        el('h1', {}, 'This tool did not load'),
        el('p', {}, message)
      ),
      el(
        'p',
        { style: { marginTop: '16px' } },
        el('a', { class: 'btn btn-primary', href: '#/' + defaultToolId }, 'Back to AniManga Wrapped')
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

  // Close sidebar on navigation (mobile)
  closeSidebar();
}

function onHashChange() {
  mountRoute();
}

function toggleSidebar() {
  const isOpen = dom.sidebar.getAttribute('data-state') === 'open';
  dom.sidebar.setAttribute('data-state', isOpen ? 'closed' : 'open');
  dom.sidebarBackdrop.setAttribute('data-visible', isOpen ? 'false' : 'true');
  dom.sidebarToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
}

function closeSidebar() {
  dom.sidebar.setAttribute('data-state', 'closed');
  dom.sidebarBackdrop.setAttribute('data-visible', 'false');
  dom.sidebarToggle.setAttribute('aria-expanded', 'false');
}

function start() {
  renderBrand();
  renderNav();
  renderFooter();

  // Sidebar toggle
  dom.sidebarToggle.addEventListener('click', toggleSidebar);
  dom.sidebarBackdrop.addEventListener('click', closeSidebar);

  // Close sidebar on Escape
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSidebar();
    }
  });

  // Close sidebar when clicking a nav link
  dom.nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      closeSidebar();
    }
  });

  // Prevent scroll restoration on navigation
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  if (!window.location.hash) {
    window.location.replace('#/' + defaultToolId);
  }

  window.addEventListener('hashchange', onHashChange);
  mountRoute();
}

start();