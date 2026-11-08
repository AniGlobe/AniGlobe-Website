/**
 * Public profile page: #/profile?u=username
 *
 * Rendered by the shell directly (like #/verify and #/reset), not through
 * the tool registry. Only public fields are fetched — the backend never
 * returns email, sessions, or sync payloads.
 */

import { el, render } from '../lib.js';
import { AuthError, getPublicProfile } from '../auth.js';
import { initialAvatarDataUrl } from '../domain/avatar.js';

function usernameFromHash() {
  const search = (window.location.hash && window.location.hash.includes('?'))
    ? window.location.hash.slice(window.location.hash.indexOf('?'))
    : '';
  return (new URLSearchParams(search).get('u') || '').trim();
}

export function renderProfile(root) {
  const username = usernameFromHash();
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const content = el('div', { class: 'account-stack' }, status);

  render(
    root,
    el(
      'div',
      { class: 'tool-head' },
      el('h1', {}, username ? '@' + username : 'Profile'),
      el('p', {}, 'Public AniGlobe profile.')
    ),
    el('section', { class: 'panel account-panel' }, content),
    el(
      'p',
      { style: { marginTop: '16px' } },
      el('a', { class: 'btn btn-quiet', href: '#/library' }, 'Browse the template library')
    )
  );

  if (!username) {
    status.textContent = 'No username in this link. Profile links look like #/profile?u=yourname.';
    status.dataset.tone = 'error';
    return;
  }

  status.textContent = 'Loading profile…';
  getPublicProfile(username)
    .then((profile) => {
      if (!profile) {
        status.textContent = 'That profile does not exist.';
        status.dataset.tone = 'error';
        return;
      }
      status.dataset.tone = '';
      const avatar = el('img', {
        class: 'account-avatar account-avatar-lg',
        src: profile.avatar || initialAvatarDataUrl(profile.username),
        alt: 'Avatar for ' + profile.username,
      });
      const badge = profile.verified
        ? el('span', { class: 'account-verified' }, 'Verified')
        : el('span', { class: 'account-unverified' }, 'Not verified');
      render(
        content,
        el(
          'div',
          { class: 'account-profile-head' },
          avatar,
          el('p', { class: 'account-profile-name' }, '@' + profile.username, ' ', badge)
        ),
        profile.bio ? el('p', { class: 'account-profile-bio' }, profile.bio) : el('p', { class: 'account-danger-note' }, 'No bio yet.'),
        el('p', { class: 'account-danger-note' }, 'Member since ' + new Date(profile.createdAt).toLocaleDateString()),
        el(
          'div',
          { class: 'kpis account-history-kpis' },
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Played'), el('strong', { class: 'kpi-value num' }, String(profile.stats.gamesPlayed))),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Wins'), el('strong', { class: 'kpi-value num' }, String(profile.stats.wins))),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Win rate'), el('strong', { class: 'kpi-value num' }, String(profile.stats.winRate) + '%')),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Streak'), el('strong', { class: 'kpi-value num' }, String(profile.stats.currentStreak != null ? profile.stats.currentStreak : 0))),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Best'), el('strong', { class: 'kpi-value num' }, String(profile.stats.bestStreak != null ? profile.stats.bestStreak : 0)))
        )
      );
    })
    .catch((error) => {
      status.textContent = error instanceof AuthError ? error.message : 'Could not load that profile.';
      status.dataset.tone = 'error';
    });
}
