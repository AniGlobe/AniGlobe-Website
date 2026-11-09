/**
 * Browse Tools page: #/tools
 * App-launcher grid of every visible tool as square tiles. Reached from the
 * homepage "Browse Tools" button. Content comes from the tool registry.
 */

import { el, render } from '../lib.js';
import { site, tools } from '../config.js';
import { getSession } from '../auth.js';

export function renderToolsPage(root) {
  const session = getSession();
  const visibleTools = tools.filter((tool) => !tool.hidden);
  const tile = (id, label, href) =>
    el('a', { class: 'home-tile home-tile-' + id, href },
      el('span', { class: 'home-tile-icon', 'aria-hidden': 'true' }, label.slice(0, 1).toUpperCase()),
      el('span', { class: 'home-tile-label' }, label),
      el('span', { class: 'home-tile-sub' }, id === 'home' ? 'Start here' : (tools.find((t) => t.id === id)?.category === 'play' ? 'Daily puzzle' : 'Create'))
    );
  const tiles = [
    tile('home', 'Home', '#/home'),
    ...visibleTools.map((tool) => tile(tool.id, tool.label, '#/' + tool.id)),
  ];

  render(
    root,
    el('div', { class: 'home home-tools-page' },
      el('h1', { class: 'home-title' }, 'Browse Tools'),
      el('p', { class: 'onboarding-lead' }, session ? 'Welcome back, ' + session.user.username + '.' : 'Pick a tool to open. Wrapped and Guess work as guests; accounts sync everything.'),
      el('div', { class: 'home-tiles' }, ...tiles),
      el('p', { class: 'home-tiles-cta' },
        el('a', { class: 'btn btn-quiet btn-sm', href: '#/home' }, 'Back to home'),
      
      )
    )
  );
}
