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
        el('a', { class: 'btn btn-primary home-cta-lg', href: '#/card' }, 'Open Wrapped'),
        el('a', { class: 'btn btn-outline home-cta-lg', href: '#/account' }, 'My account'),
      ]
    : [
        el('a', { class: 'btn btn-primary home-cta-lg', href: '#/signup' }, 'Create free account'),
        el('a', { class: 'btn btn-outline home-cta-lg', href: '#/login' }, 'Log in'),
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
    { class: 'home-section' },
    el('div', { class: 'home-features' },
      ...visibleTools.map((tool) =>
        el('a', { class: 'home-feature-card', href: '#/' + tool.id },
          el('span', { class: 'home-feature-label' }, tool.label),
          el('span', { class: 'home-feature-desc' }, tool.blurb || ''),
          el('span', { class: 'home-feature-arrow', 'aria-hidden': 'true' }, '→')
        )
      )
    )
  );

  render(root, el('div', { class: 'home' }, hero, featuresSection));
}
