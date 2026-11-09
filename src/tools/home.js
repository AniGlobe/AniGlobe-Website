/**
 * Standalone homepage: #/ (and #/home, #/welcome alias)
 * Professional landing: hero, steps, features, library teaser.
 * Content pulls from site config and the tool registry (no hard-coded
 * feature list). Playful yet elegant: dark ground, accent glow, big type,
 * rounded cards, gentle hover lift.
 */

import { el, render } from '../lib.js';
import { site, tools } from '../config.js';
import { getSession, listPublicTemplates } from '../auth.js';

const STEPS = [
  { title: 'Build your wrap', text: 'Paste any public MyAnimeList or AniList username, pick a palette, and export a shareable card.' },
  { title: 'Play daily', text: 'Five clues, one title. Your streak is saved when you are signed in.' },
  { title: 'Sync everywhere', text: 'Preferences, templates, and streaks follow you. Publish templates to the library.' },
];

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
        el('a', { class: 'btn btn-quiet', href: '#/card' }, 'Try Wrapped as guest'),
      ];

  const hero = el(
    'section',
    { class: 'home-hero' },
    el('div', { class: 'home-hero-copy' },
      el('p', { class: 'onboarding-eyebrow' }, site.name),
      el('h1', { class: 'home-title' }, site.tagline),
      el('p', { class: 'onboarding-lead' },
        session ? 'Welcome back, ' + session.user.username + '. Your streaks and templates are synched.' : 'Turn any public anime or manga profile into a shareable wrap card, then play the daily title-guessing game. Private by default, beautiful by design.'),
      el('div', { class: 'onboarding-ctas' }, ...heroCtas),
      el('p', { class: 'home-hero-note' }, session ? 'Signed in. Everything you finish syncs to your account.' : 'No credit card · No tracking · Export as PNG')
    ),
    el(
      'div',
      { class: 'home-hero-visual', 'aria-hidden': 'true' },
      el('span', { class: 'home-visual-card home-visual-card-a' }, 'Wrapped'),
      el('span', { class: 'home-visual-card home-visual-card-b' }, 'Daily'),
      el('span', { class: 'home-visual-card home-visual-card-c' }, 'Library')
    )
  );

  const stepsSection = el(
    'section',
    { class: 'home-section' },
    el('h2', { class: 'home-h2' }, 'How it works'),
    el('ol', { class: 'onboarding-steps' }, ...STEPS.map((step, i) =>
      el('li', { class: 'onboarding-step' },
        el('span', { class: 'onboarding-step-num num' }, String(i + 1)),
        el('div', {}, el('h3', {}, step.title), el('p', {}, step.text))
      )
    ))
  );

  const featuresSection = el(
    'section',
    { class: 'home-section' },
    el('h2', { class: 'home-h2' }, 'Features'),
    el('div', { class: 'home-features' },
      ...visibleTools.map((tool, index) =>
        el('a', { class: 'home-feature-card' + (index === 0 ? ' home-feature-card-featured' : ''), href: '#/' + tool.id },
          el('span', { class: 'home-feature-label' }, tool.label),
          el('span', { class: 'home-feature-desc' }, tool.blurb || ''),
          el('span', { class: 'home-feature-arrow', 'aria-hidden': 'true' }, '→')
        )
      )
    )
  );

  const libraryTeaser = el('section', { class: 'home-section' },
    el('h2', { class: 'home-h2' }, 'From the library'),
    el('p', { class: 'home-section-lead' }, 'Public templates people have published. Use one to save a copy.'),
    el('div', { class: 'home-teaser-grid', id: 'home-teaser-grid' }, el('p', { class: 'account-danger-note' }, 'Loading templates…')),
    el('p', { style: { marginTop: '16px' } }, el('a', { class: 'btn btn-outline btn-sm', href: '#/library' }, 'Browse all templates'))
  );

  render(root, el('div', { class: 'home' }, hero, stepsSection, featuresSection, libraryTeaser));

  // Teaser is progressive enhancement: failures leave the loading copy.
  listPublicTemplates({ limit: 3 })
    .then((items) => {
      const grid = document.getElementById('home-teaser-grid');
      if (!grid || !items.length) {
        if (grid) render(grid, el('p', { class: 'account-danger-note' }, 'No public templates yet. Publish one from the studio.'));
        return;
      }
      render(grid, ...items.map((t) =>
        el('a', { class: 'home-teaser-card', href: '#/library' },
          el('span', { class: 'library-preview-dot library-dot-' + String(t.theme || 'none') }),
          el('span', { class: 'library-name' }, t.name),
          el('span', { class: 'library-meta' }, '@' + t.author + (t.theme ? ' · ' + t.theme : ''))
        )
      ));
    })
    .catch(() => {
      const grid = document.getElementById('home-teaser-grid');
      if (grid) render(grid, el('p', { class: 'account-danger-note' }, 'Library is unavailable right now.'));
    });
}
