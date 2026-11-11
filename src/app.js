/**
 * Shell bootstrap and hash router.
 *
 * Reads the tool registry from config, renders the chrome, and mounts one
 * tool at a time. A tool's mount() may return a cleanup function; the router
 * calls it before mounting the next one so listeners and timers do not pile up.
 */

import { site, tools, TOOL_CATEGORIES, resolveToolId, defaultToolId } from './config.js';
import { el, render } from './lib.js';
import { getProfile, getSession, logout, onSessionChange, refreshSession } from './auth.js';
import { renderReset, renderVerify } from './tools/auth-links.js';
import { renderProfile } from './tools/profile-page.js';
import { renderTitle } from './tools/title-page.js';
import { renderAuthPage } from './tools/auth-page.js';
import { renderHome } from './tools/home.js';
import { renderToolsPage } from './tools/tools-page.js';
import { initialAvatarDataUrl } from './domain/avatar.js';

const dom = {
  topbarBrand: document.querySelector('.topbar-brand'),
  topbarActions: document.querySelector('.topbar-auth-slot'),
  themeToggle: document.getElementById('theme-toggle'),
  sidebar: document.getElementById('site-sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  nav: document.getElementById('nav'),
  sidebarFoot: document.querySelector('.sidebar-foot'),
  app: document.getElementById('app'),
  footer: document.getElementById('footer'),
};



function closeTopbarMenus() {
  const open = document.querySelector('.topbar-menu:not([hidden])');
  if (!open) return;
  open.hidden = true;
  const trigger = open.parentElement && open.parentElement.querySelector('[aria-haspopup="true"]');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function renderTopbarAuth() {
  const session = getSession();
  const actions = [];
  if (session) {
    const avatarImg = el('img', {
      class: 'topbar-avatar-btn-img',
      src: initialAvatarDataUrl(session.user.username),
      alt: 'Profile picture for ' + session.user.username,
    });
    const avatarButton = el(
      'button',
      {
        class: 'topbar-avatar-btn',
        type: 'button',
        'aria-haspopup': 'true',
        'aria-expanded': 'false',
        'aria-label': 'Account menu for ' + session.user.username,
      },
      avatarImg
    );
    const profileLink = el('a', { class: 'topbar-menu-item', href: '#/account', role: 'menuitem' }, 'Profile');
    const logoutButton = el('button', { class: 'topbar-menu-item', type: 'button', role: 'menuitem' }, 'Log out');
    const menu = el('div', { class: 'topbar-menu', role: 'menu', hidden: true }, profileLink, logoutButton);
    const wrapper = el('div', { class: 'topbar-account-menu' }, avatarButton, menu);

    avatarButton.addEventListener('click', () => {
      const nowOpen = menu.hidden;
      closeTopbarMenus();
      menu.hidden = !nowOpen;
      avatarButton.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen) profileLink.focus();
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeTopbarMenus();
        avatarButton.focus();
      }
    });
    profileLink.addEventListener('click', () => {
      closeTopbarMenus();
    });
    logoutButton.addEventListener('click', async () => {
      await logout();
      if (resolveToolId(window.location.hash) === 'account') window.location.hash = '#/' + defaultToolId;
    });
    actions.push(wrapper);
    // Upgrade to a custom avatar when it exists; the generated initial
    // paints instantly and is replaced once the profile loads.
    getProfile()
      .then((profile) => {
        if (profile && profile.avatar) avatarImg.src = profile.avatar;
      })
      .catch(() => {
        /* offline: keep the generated initial */
      });
  } else {
    actions.push(
      el('a', { class: 'btn btn-outline btn-sm topbar-login', href: '#/login' }, 'Log In'),
      el('a', { class: 'btn btn-primary btn-sm topbar-signup', href: '#/signup' }, 'Create Account')
    );
  }
  render(dom.topbarActions, ...actions);
  renderSidebarAuth();
}

/** Guests get the signup path inside the sidebar, so the mobile header can
 *  drop the second button without losing the route. */
function renderSidebarAuth() {
  const foot = dom.sidebarFoot;
  if (!foot) return;
  const existing = foot.querySelector('.sidebar-auth');
  if (existing) existing.remove();
  if (getSession()) return;
  foot.append(
    el(
      'div',
      { class: 'sidebar-auth' },
      el('a', { class: 'btn btn-primary btn-sm', href: '#/signup' }, 'Create Account'),
      el('a', { class: 'btn btn-quiet btn-sm', href: '#/login' }, 'Log In')
    )
  );
}

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
  const homeLink = el('a', { class: 'nav-link', href: '#/home', dataset: { tool: 'home' } }, el('span', {}, 'Home'));
  const groups = TOOL_CATEGORIES.map((category) => {
    const items = tools.filter((tool) => !tool.hidden && tool.category === category.id);
    if (!items.length) return null;
    return el(
      'div',
      { class: 'nav-group' },
      el('p', { class: 'sidebar-caption' }, category.label),
      ...items.map((tool) =>
        el(
          'a',
          { class: 'nav-link', href: '#/' + tool.id, dataset: { tool: tool.id } },
          el('span', {}, tool.label)
        )
      )
    );
  });
  render(dom.nav, homeLink, ...groups);
}

function renderFooter() {
  const categoryLinks = [
    el('nav', { class: 'footer-links', 'aria-label': 'AniGlobe home' }, el('h3', {}, 'Home'), el('a', { href: '#/home' }, 'Home')),
    ...TOOL_CATEGORIES.map((category) => {
      const links = tools.filter((tool) => !tool.hidden && tool.category === category.id);
      if (!links.length) return null;
      return el(
        'nav',
        { class: 'footer-links', 'aria-label': 'AniGlobe ' + category.label.toLowerCase() },
        el('h3', {}, category.label),
        ...links.map((tool) => el('a', { href: '#/' + tool.id }, tool.label))
      );
    }),
  ];
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
        'div',
        { class: 'footer-intro' },
        el(
          'a',
          { class: 'footer-brand', href: '#/', 'aria-label': site.name + ', home' },
          el('img', {
            src: 'assets/logo/AniGlobe/AniGlobe - PRIMARY LOGO TRANSPARENT.png',
            alt: '',
            class: 'footer-logo logo-dark'
          }),
          el('img', {
            src: 'assets/logo/AniGlobe/AniGlobe - PRIMARY LOGO LIGHT TRANSPARENT.png',
            alt: '',
            class: 'footer-logo logo-light'
          })
        ),
        el('p', { class: 'footer-tagline' }, site.tagline)
      ),
      el(
        'div',
        { class: 'footer-directory' },
        ...categoryLinks,
        el(
          'nav',
          { class: 'footer-links', 'aria-label': 'Data sources' },
          el('h3', {}, 'Data sources'),
          ...sources
        )
      )
    ),
    el(
      'div',
      { class: 'footer-base' },
      el('p', { class: 'footer-copyright' }, '© ' + new Date().getFullYear() + ' AniGlobe. An independent project.'),
      el('p', { class: 'footer-disclaimer' }, 'MyAnimeList, Jikan-Edge, and AniList are not affiliated with AniGlobe.')
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

function runCleanup() {
  if (typeof cleanupCurrent === 'function') {
    try {
      cleanupCurrent();
    } catch {
      /* a broken cleanup must not block navigation */
    }
  }
  cleanupCurrent = null;
}

async function mountRoute() {
  const rawHash = String(window.location.hash || '');
  const rawPath = rawHash.charAt(0) === '#' ? rawHash.slice(1) : rawHash;
  if (rawPath.startsWith('/verify')) {
    mountToken += 1;
    runCleanup();
    render(dom.app);
    renderVerify(dom.app);
    document.title = 'Confirm your email | ' + site.name;
    dom.app.focus({ preventScroll: true });
    return;
  }
  if (rawPath.startsWith('/reset')) {
    mountToken += 1;
    runCleanup();
    render(dom.app);
    renderReset(dom.app);
    document.title = 'Reset your password | ' + site.name;
    dom.app.focus({ preventScroll: true });
    return;
  }
  if (rawPath.startsWith('/profile')) {
    mountToken += 1;
    runCleanup();
    render(dom.app);
    renderProfile(dom.app);
    document.title = 'Profile | ' + site.name;
    dom.app.focus({ preventScroll: true });
    return;
  }
  if (rawPath.startsWith('/title')) {
    mountToken += 1;
    runCleanup();
    render(dom.app);
    renderTitle(dom.app);
    document.title = 'Title | ' + site.name;
    dom.app.focus({ preventScroll: true });
    return;
  }
  if (rawPath.startsWith('/login')) {
    mountToken += 1;
    runCleanup();
    render(dom.app);
    renderAuthPage(dom.app, 'login');
    document.title = 'Log in | ' + site.name;
    dom.app.focus({ preventScroll: true });
    return;
  }
  if (rawPath.startsWith('/signup')) {
    mountToken += 1;
    runCleanup();
    render(dom.app);
    renderAuthPage(dom.app, 'register');
    document.title = 'Create your account | ' + site.name;
    dom.app.focus({ preventScroll: true });
    return;
  }
  if (rawPath === '' || rawPath === '/' || rawPath.startsWith('/home') || rawPath.startsWith('/welcome')) {
    mountToken += 1;
    runCleanup();
    render(dom.app);
    renderHome(dom.app);
    document.title = 'AniGlobe: Your anime world, wrapped';
    dom.app.focus({ preventScroll: true });
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  if (rawPath.startsWith('/tools')) {
    mountToken += 1;
    runCleanup();
    render(dom.app);
    renderToolsPage(dom.app);
    document.title = 'Browse Tools | ' + site.name;
    dom.app.focus({ preventScroll: true });
    closeSidebar();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }

  const toolId = resolveToolId(window.location.hash);
  const entry = tools.find((tool) => tool.id === toolId) || tools[0];
  const token = ++mountToken;

  markActiveNav(entry.id);

  runCleanup();

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
  closeTopbarMenus();
  mountRoute();
}

function toggleSidebar() {
  const isOpen = dom.sidebar.getAttribute('data-state') === 'open';
  dom.sidebar.setAttribute('data-state', isOpen ? 'closed' : 'open');
  dom.sidebarBackdrop.setAttribute('data-visible', isOpen ? 'false' : 'true');
  dom.sidebarToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  document.body.dataset.sidebar = isOpen ? 'closed' : 'open';
}

function closeSidebar() {
  dom.sidebar.setAttribute('data-state', 'closed');
  dom.sidebarBackdrop.setAttribute('data-visible', 'false');
  dom.sidebarToggle.setAttribute('aria-expanded', 'false');
  document.body.dataset.sidebar = 'closed';
}

const THEME_KEY = 'aniglobe:theme';
function initTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem(THEME_KEY);
  } catch {
    theme = null;
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  syncThemeButton();
}

function syncThemeButton() {
  if (!dom.themeToggle) return;
  const isLight = document.documentElement.dataset.theme === 'light';
  dom.themeToggle.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
  dom.themeToggle.title = isLight ? 'Dark mode' : 'Light mode';
  dom.themeToggle.dataset.mode = isLight ? 'light' : 'dark';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  syncThemeButton();
}

function start() {
  initTheme();
  renderBrand();
  renderNav();
  renderFooter();
  renderTopbarAuth();
  onSessionChange(renderTopbarAuth);
  refreshSession();
  if (dom.themeToggle) dom.themeToggle.addEventListener('click', toggleTheme);

  // Sidebar toggle
  dom.sidebarToggle.addEventListener('click', toggleSidebar);
  dom.sidebarBackdrop.addEventListener('click', closeSidebar);

  // Close sidebar on Escape; close the account menu on Escape/outside click
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.querySelector('.topbar-menu:not([hidden])')) {
        const trigger = document.querySelector('.topbar-avatar-btn[aria-expanded="true"]');
        closeTopbarMenus();
        if (trigger) trigger.focus();
      } else {
        closeSidebar();
      }
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.topbar-account-menu')) closeTopbarMenus();
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
    window.location.replace('#/');
  }

  window.addEventListener('hashchange', onHashChange);
  mountRoute();
}

start();