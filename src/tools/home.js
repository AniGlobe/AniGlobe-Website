/**
 * Standalone homepage: #/ (and #/home, #/welcome alias)
 * Lean landing: hero plus the tool directory. Content pulls from site
 * config and the tool registry (no hard-coded feature list).
 */

import { el, render } from '../lib.js';
import { site } from '../config.js';
import { getSession } from '../auth.js';

export function renderHome(root) {
  const session = getSession();

  const heroCtas = session
    ? [
        el('a', { class: 'btn btn-primary home-cta-lg', href: '#/tools' }, 'Browse Tools'),
        el('a', { class: 'btn btn-outline home-cta-lg', href: '#/card' }, 'Open Wrapped'),
        el('a', { class: 'btn btn-quiet', href: '#/account' }, 'My account'),
      ]
    : [
        el('a', { class: 'btn btn-primary home-cta-lg', href: '#/tools' }, 'Browse Tools'),
        el('a', { class: 'btn btn-outline home-cta-lg', href: '#/signup' }, 'Create free account'),
        el('a', { class: 'btn btn-quiet', href: '#/login' }, 'Log in'),
      ];

  const hero = el(
    'section',
    { class: 'home-hero' },
    el('div', { class: 'home-hero-copy' },
      el('h1', { class: 'home-title' }, site.tagline),
      session ? el('p', { class: 'onboarding-lead' }, 'Welcome back, ' + session.user.username + '.') : null,
      el('div', { class: 'onboarding-ctas' }, ...heroCtas)
    ),
    el(
      'div',
      { class: 'home-hero-visual', 'aria-hidden': 'true' },
      el('span', { class: 'home-visual-card home-visual-card-a' }, 'Wrapped'),
      el('span', { class: 'home-visual-card home-visual-card-b' }, 'Daily'),
      el('span', { class: 'home-visual-card home-visual-card-c' }, 'Library')
    )
  );

  render(root, el('div', { class: 'home' }, hero));
}
