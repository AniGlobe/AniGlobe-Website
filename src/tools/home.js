/**
 * Standalone homepage: #/ (and #/home, #/welcome alias)
 * Lean landing: hero plus the tool directory. Content pulls from site
 * config and the tool registry (no hard-coded feature list).
 */

import { el, render } from '../lib.js';
import { site, tools } from '../config.js';
import { getSession } from '../auth.js';

export function renderHome(root) {
  const session = getSession();
  const visibleTools = tools.filter((tool) => !tool.hidden);

  const heroCtas = session
    ? [
        el('a', { class: 'btn btn-primary home-cta-lg', href: '#tools' }, 'Browse Tools'),
      ]
    : [
        el('a', { class: 'btn btn-primary home-cta-lg', href: '#tools' }, 'Browse Tools'),
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

  const featuresSection = el(
    'section',
    { class: 'home-section', id: 'tools' },
    el('div', { class: 'home-tiles' },
      ...visibleTools.map((tool) =>
        el('a', { class: 'home-tile', href: '#/' + tool.id },
          el('span', { class: 'home-tile-icon', 'aria-hidden': 'true' }, tool.label.slice(0, 1).toUpperCase()),
          el('span', { class: 'home-tile-label' }, tool.label)
        )
      )
    ),
    session
      ? el('p', { class: 'home-tiles-cta' }, el('a', { class: 'btn btn-quiet btn-sm', href: '#/account' }, 'My account'))
      : el('p', { class: 'home-tiles-cta' }, el('a', { class: 'btn btn-quiet btn-sm', href: '#/login' }, 'Log in'), el('a', { class: 'btn btn-primary btn-sm', href: '#/signup' }, 'Create free account'))
  );

  render(root, el('div', { class: 'home' }, hero, featuresSection));
}
