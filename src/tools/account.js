/**
 * Account page: who you are, what syncs, your devices (active sessions),
 * change your password, export your data, and delete the account. Reached
 * from the topbar account menu (#/account).
 */

import { el, render, setStatus, dayIndex } from '../lib.js';
import {
  AuthError,
  changePassword,
  deleteAccount,
  exportData,
  getSession,
  listSessions,
  logout,
  onSessionChange,
  pullGuessProgress,
  resendVerification,
  revokeAllSessions,
  revokeSession,
  requestPasswordReset,
} from '../auth.js';
import { resolveMediaType } from '../domain/media.js';
import { buildMonthCalendar, dayIndexToDate, summarizeProgress } from '../domain/streak.js';

const RECENT_LIMIT = 10;

function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Mobile|Android|iPhone/.test(ua)) return 'Mobile browser';
  return ua ? 'Browser' : 'Unknown device';
}

export default {
  id: 'account',
  title: 'Account',
  blurb: 'Manage your AniGlobe account.',

  mount(root, tool = {}) {
    let alive = true;

    function renderPage() {
      const session = getSession();
      const heading = el(
        'div',
        { class: 'tool-head' },
        el('h1', {}, 'Account'),
        el('p', {}, 'Your account syncs Wrapped preferences, templates, and daily guess streaks.')
      );

      if (!session) {
        render(
          root,
          heading,
          el(
            'section',
            { class: 'panel' },
            el('p', {}, 'You are browsing as a guest. Nothing you enter leaves this browser.'),
            el(
              'p',
              { style: { marginTop: '16px' } },
              el('a', { class: 'btn btn-primary', href: '#/card' }, 'Back to AniManga Wrapped')
            )
          )
        );
        return;
      }

      const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });

      // --- email verification state -------------------------------------
      const verified = Boolean(session.user.verified);
      const verifiedBadge = verified
        ? el('span', { class: 'account-verified' }, 'Verified')
        : el('span', { class: 'account-unverified' }, 'Not verified');
      const resendButton = el('button', { class: 'btn btn-outline btn-sm', type: 'button' }, 'Resend confirmation email');
      resendButton.hidden = verified;

      // --- sessions -------------------------------------------------------
      const sessionList = el('ul', { class: 'account-sessions' }, el('li', { class: 'account-session' }, 'Loading devices…'));
      const revokeAllButton = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Sign out everywhere');

      async function refreshSessions() {
        let rows = [];
        try {
          rows = await listSessions();
        } catch {
          rows = [];
        }
        render(
          sessionList,
          ...rows.map((entry) =>
            el(
              'li',
              { class: 'account-session' },
              el(
                'span',
                { class: 'account-session-label' },
                describeDevice(entry.userAgent) + (entry.current ? ' (this device)' : '') + ' · ' + entry.ip
              ),
              el('span', { class: 'account-session-last' }, 'last seen ' + new Date(entry.lastSeenAt || entry.createdAt).toLocaleString()),
              entry.current
                ? null
                : el('button', { class: 'btn btn-quiet btn-sm', type: 'button', dataset: { revoke: String(entry.id) } }, 'Revoke')
            )
          )
        );
      }

      const sessionsSection = el(
        'section',
        { class: 'panel account-panel' },
        el('h2', { class: 'panel-title' }, 'Devices signed in'),
        sessionList,
        revokeAllButton
      );

      // --- guess history + streak calendar (Track B · B002) ----------------
      // Data comes from the already-synced guess_progress rows; no new table.
      let guessRows = [];
      let viewYear = new Date().getFullYear();
      let viewMonth = new Date().getMonth();

      const historyStats = el('div', { class: 'kpis account-history-kpis' });
      const calendarTitle = el('h3', { class: 'account-calendar-title' });
      const calendarPrev = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Previous month' }, '←');
      const calendarNext = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Next month' }, '→');
      const calendarGrid = el('div', { class: 'account-calendar-grid', role: 'grid', 'aria-label': 'Guess calendar' });
      const calendarLegend = el(
        'div',
        { class: 'account-calendar-legend' },
        el('span', {}, 'Won'),
        el('span', {}, 'Played'),
        el('span', {}, 'Not played')
      );
      const recentList = el('ul', { class: 'account-history-list' });
      const historyEmpty = el('p', { class: 'account-danger-note' }, 'No synced results yet. Finish a daily round while signed in and it will appear here.');

      const guessSection = el(
        'section',
        { class: 'panel account-panel' },
        el('h2', { class: 'panel-title' }, 'Guess history'),
        historyStats,
        el(
          'div',
          { class: 'account-calendar-head' },
          calendarPrev,
          calendarTitle,
          calendarNext
        ),
        calendarGrid,
        calendarLegend,
        el('h3', { class: 'panel-title account-recent-title' }, 'Recent results'),
        recentList,
        historyEmpty
      );

      function weekdayHeader() {
        // Localized short weekday names for one known Sunday (2024-01-07).
        const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
        return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2024, 0, 7 + i)));
      }

      function renderCalendar() {
        const todayIndex = dayIndex();
        const month = buildMonthCalendar(viewYear, viewMonth, guessRows, { todayIndex });
        calendarTitle.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
          new Date(viewYear, viewMonth, 1)
        );
        const cells = [];
        for (const label of weekdayHeader()) {
          cells.push(el('span', { class: 'account-calendar-weekday', 'aria-hidden': 'true' }, label));
        }
        for (let i = 0; i < month.firstWeekday; i += 1) {
          cells.push(el('span', { class: 'account-calendar-cell is-blank', 'aria-hidden': 'true' }));
        }
        for (const day of month.days) {
          const date = dayIndexToDate(day.dayIndex);
          const detail = day.entries.length
            ? day.entries
                .map((e) => resolveMediaType(e.mediaType).label + (e.won ? ' won' : ' lost') + ', ' + Number(e.score || 0) + ' pts')
                .join(' · ')
            : day.state === 'future' ? 'Future' : 'Not played';
          cells.push(
            el(
              'span',
              {
                class: 'account-calendar-cell' + (day.state === 'won' ? ' is-won' : '') + (day.state === 'played' ? ' is-played' : '') + (day.state === 'future' ? ' is-future' : ''),
                title: date.toLocaleDateString() + ' — ' + detail,
                'aria-label': date.toLocaleDateString() + ': ' + detail,
                role: 'gridcell',
              },
              String(day.day)
            )
          );
        }
        render(calendarGrid, ...cells);
        const now = new Date();
        calendarNext.disabled = viewYear === now.getFullYear() && viewMonth >= now.getMonth();
      }

      async function refreshHistory() {
        try {
          guessRows = await pullGuessProgress();
        } catch {
          guessRows = [];
        }
        const summary = summarizeProgress(guessRows, { todayIndex: dayIndex() });
        historyEmpty.hidden = summary.total > 0;
        render(
          historyStats,
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Played'), el('strong', { class: 'kpi-value num' }, String(summary.total))),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Wins'), el('strong', { class: 'kpi-value num' }, String(summary.wins))),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Win rate'), el('strong', { class: 'kpi-value num' }, String(summary.winRate) + '%')),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Streak'), el('strong', { class: 'kpi-value num' }, String(summary.currentStreak))),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-label' }, 'Best'), el('strong', { class: 'kpi-value num' }, String(summary.bestStreak)))
        );
        renderCalendar();
        render(
          recentList,
          ...summary.recent.slice(0, RECENT_LIMIT).map((row) => {
            const date = dayIndexToDate(row.dayIndex);
            return el(
              'li',
              { class: 'account-history-row' },
              el('span', {}, date.toLocaleDateString()),
              el('span', {}, resolveMediaType(row.mediaType).label),
              el('span', { class: row.won ? 'account-history-won' : 'account-history-lost' }, row.won ? 'Won' : 'Lost'),
              el('span', { class: 'num' }, String(Number(row.score || 0)) + ' pts')
            );
          })
        );
      }

      calendarPrev.addEventListener('click', () => {
        viewMonth -= 1;
        if (viewMonth < 0) {
          viewMonth = 11;
          viewYear -= 1;
        }
        renderCalendar();
      });
      calendarNext.addEventListener('click', () => {
        viewMonth += 1;
        if (viewMonth > 11) {
          viewMonth = 0;
          viewYear += 1;
        }
        renderCalendar();
      });

      // --- password + danger zone ----------------------------------------
      const currentPassword = el('input', { type: 'password', id: 'account-current', autocomplete: 'current-password', maxlength: '128' });
      const newPassword = el('input', { type: 'password', id: 'account-next', autocomplete: 'new-password', maxlength: '128' });
      const changeForm = el(
        'form',
        { class: 'account-form' },
        el('div', { class: 'field' }, el('label', { for: 'account-current' }, 'Current password'), currentPassword),
        el('div', { class: 'field' }, el('label', { for: 'account-next' }, 'New password'), newPassword),
        el('button', { class: 'btn btn-outline', type: 'submit' }, 'Change password')
      );

      const resetEmail = el('input', { type: 'email', id: 'account-reset-email', autocomplete: 'email', maxlength: '254' });
      resetEmail.value = session.user.email;
      const resetForm = el(
        'form',
        { class: 'account-form' },
        el('div', { class: 'field' }, el('label', { for: 'account-reset-email' }, 'Forgot your password?'), resetEmail),
        el('button', { class: 'btn btn-quiet', type: 'submit' }, 'Email me a reset link')
      );

      const confirmPassword = el('input', { type: 'password', id: 'account-delete-password', autocomplete: 'current-password', maxlength: '128' });
      const deleteButton = el('button', { class: 'btn btn-danger', type: 'button' }, 'Delete my account');
      const exportButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Download my data (JSON)');
      const logoutButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Log out');

      const body = el(
        'div',
        { class: 'account-stack' },
        el(
          'section',
          { class: 'panel account-panel' },
          el(
            'dl',
            { class: 'account-details' },
            el('div', { class: 'account-detail' }, el('dt', {}, 'Username'), el('dd', {}, session.user.username)),
            el('div', { class: 'account-detail' }, el('dt', {}, 'Email'), el('dd', {}, session.user.email, ' ', verifiedBadge)),
            el('div', { class: 'account-detail' }, el('dt', {}, 'Member since'), el('dd', {}, new Date(session.user.createdAt).toLocaleDateString()))
          ),
          el('div', { class: 'account-verify-row' }, resendButton),
          el('h2', { class: 'panel-title' }, 'Change password'),
          changeForm,
          el('h2', { class: 'panel-title' }, 'Reset by email'),
          el(
            'p',
            { class: 'account-danger-note' },
            'We email a one-hour reset link. The request answers the same whether or not the email exists.'
          ),
          resetForm,
          el('h2', { class: 'panel-title' }, 'Your data'),
          exportButton,
          el('h2', { class: 'panel-title' }, 'Danger zone'),
          el(
            'p',
            { class: 'account-danger-note' },
            'Deleting your account removes your credentials, synced preferences, templates, and guess progress. This cannot be undone.'
          ),
          el('div', { class: 'field' }, el('label', { for: 'account-delete-password' }, 'Confirm with your password'), confirmPassword),
          deleteButton,
          el('h2', { class: 'panel-title' }, 'Session'),
          logoutButton,
          status
        ),
        sessionsSection,
        guessSection
      );

      render(root, heading, body);
      refreshSessions();
      refreshHistory();

      sessionList.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-revoke]');
        if (!button) return;
        try {
          await revokeSession(Number(button.dataset.revoke));
          setStatus(status, 'Device signed out.', 'info');
          refreshSessions();
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not revoke that device.', 'error');
        }
      });

      revokeAllButton.addEventListener('click', async () => {
        try {
          await revokeAllSessions();
          window.location.hash = '#/card';
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not sign out everywhere.', 'error');
        }
      });

      resendButton.addEventListener('click', async () => {
        try {
          await resendVerification();
          setStatus(status, 'Confirmation email sent.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not resend the email.', 'error');
        }
      });

      changeForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await changePassword(currentPassword.value, newPassword.value);
          currentPassword.value = '';
          newPassword.value = '';
          setStatus(status, 'Password changed. Your other sessions were signed out.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not change the password.', 'error');
        }
      });

      resetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          await requestPasswordReset(resetEmail.value.trim());
          setStatus(status, 'If that email has an account, a reset link is on its way.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not request a reset.', 'error');
        }
      });

      exportButton.addEventListener('click', async () => {
        try {
          await exportData();
          setStatus(status, 'Your data export downloaded.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not export your data.', 'error');
        }
      });

      deleteButton.addEventListener('click', async () => {
        if (!confirmPassword.value) {
          setStatus(status, 'Enter your password to delete your account.', 'error');
          confirmPassword.focus();
          return;
        }
        if (!window.confirm('Delete your AniGlobe account permanently?')) return;
        try {
          await deleteAccount(confirmPassword.value);
          window.location.hash = '#/card';
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not delete the account.', 'error');
        }
      });

      logoutButton.addEventListener('click', async () => {
        await logout();
        window.location.hash = '#/card';
      });
    }

    const offSessionChange = onSessionChange(() => {
      if (alive) renderPage();
    });
    renderPage();
    return () => {
      alive = false;
      offSessionChange();
    };
  },
};
