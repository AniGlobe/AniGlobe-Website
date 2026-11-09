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
    { class: 'home-hero home-hero-solo' },
    el('div', { class: 'home-hero-copy' },
      el('h1', { class: 'home-title' }, site.tagline),
      el('p', { class: 'onboarding-lead' },
        session ? 'Welcome back, ' + session.user.username + '. Your streaks and templates are synched.' : 'Turn any public anime or manga profile into a shareable wrap card, then play the daily title-guessing game.'),
      el('div', { class: 'onboarding-ctas' }, ...heroCtas)
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
