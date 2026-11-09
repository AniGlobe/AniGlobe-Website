/**
 * Onboarding page: #/welcome
 * Front door for new visitors — what AniGlobe does, three steps, and CTAs
 * to build a wrap or create an account. Content pulls from site config
 * and the tool registry so new tools appear without hard-coding.
 */

import { el, render } from '../lib.js';
import { site, tools, defaultToolId } from '../config.js';
import { getSession } from '../auth.js';

const STEPS = [
  { title: 'Build your wrap', text: 'Paste any public MyAnimeList or AniList username, pick a palette, and export a shareable card.' },
  { title: 'Play daily', text: 'Five clues, one title. Your streak is saved when you are signed in.' },
  { title: 'Sync everywhere', text: 'Preferences, templates, and streaks follow you — and you can publish templates to the library.' },
];

export function renderOnboarding(root) {
  const session = getSession();
  const visibleTools = tools.filter((tool) => !tool.hidden);
  const steps = STEPS.map((step, i) =>
    el(
      'li',
      { class: 'onboarding-step' },
      el('span', { class: 'onboarding-step-num num', 'aria-hidden': 'true' }, String(i + 1)),
      el('div', {}, el('h3', {}, step.title), el('p', {}, step.text))
    )
  );
  const ctas = session
    ? [
        el('a', { class: 'btn btn-primary', href: '#/' + defaultToolId }, 'Open Wrapped'),
        el('a', { class: 'btn btn-outline', href: '#/account' }, 'My account'),
      ]
    : [
        el('a', { class: 'btn btn-primary', href: '#/signup' }, 'Create free account'),
        el('a', { class: 'btn btn-outline', href: '#/login' }, 'Log in'),
        el('a', { class: 'btn btn-quiet', href: '#/' + defaultToolId }, 'Try Wrapped as guest'),
      ];
  const features = visibleTools.map((tool) =>
    el('a', { class: 'onboarding-feature', href: '#/' + tool.id }, el('span', {}, tool.label), el('span', { class: 'onboarding-feature-arrow', 'aria-hidden': 'true' }, '→'))
  );

  render(
    root,
    el(
      'div',
      { class: 'onboarding' },
      el('p', { class: 'onboarding-eyebrow' }, site.name),
      el('h1', { class: 'onboarding-title' }, site.tagline),
      el('p', { class: 'onboarding-lead' }, session ? 'Welcome back, ' + session.user.username + '.' : 'Turn any public anime or manga profile into a shareable wrap card, then play the daily title-guessing game. No tracking beyond what you sync.'),
      el('div', { class: 'onboarding-ctas' }, ...ctas),
      el('ol', { class: 'onboarding-steps' }, ...steps),
      el(
        'section',
        { class: 'panel onboarding-panel' },
        el('h2', { class: 'panel-title' }, 'Features'),
        el('div', { class: 'onboarding-features' }, ...features)
      )
    )
  );
}
