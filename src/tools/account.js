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
  getProfile,
  getSession,
  googleStartUrl,
  listAuthProviders,
  listSessions,
  logout,
  onSessionChange,
  pullGuessProgress,
  resendVerification,
  revokeAllSessions,
  revokeSession,
  requestPasswordReset,
  unlinkGoogle,
  updateProfile,
} from '../auth.js';
import { resolveMediaType } from '../domain/media.js';
import { buildMonthCalendar, dayIndexToDate, summarizeProgress } from '../domain/streak.js';
import { initialAvatarDataUrl } from '../domain/avatar.js';

const RECENT_LIMIT = 10;
const BIO_MAX_CHARS = 280; // mirrors server/api.js BIO_MAX_CHARS
const AVATAR_MAX_DIM = 256; // longest side, px — keeps the blob under the server cap

function resizeImageToDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    image.src = url;
  });
}

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
        { class: 'tool-head account-head' },
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
          ...rows.map((entry) => {
            const lastSeen = new Date(entry.lastSeenAt || entry.createdAt).toLocaleString();
            const expires = entry.expiresAt ? ' · expires ' + new Date(entry.expiresAt).toLocaleDateString() : '';
            return el(
              'li',
              { class: 'account-session' },
              el(
                'span',
                { class: 'account-session-label' },
                describeDevice(entry.userAgent) + (entry.current ? ' (this device)' : '') + ' · ' + entry.ip
              ),
              el('span', { class: 'account-session-last' }, 'last seen ' + lastSeen + expires),
              entry.current
                ? null
                : el('button', { class: 'btn btn-quiet btn-sm', type: 'button', dataset: { revoke: String(entry.id) } }, 'Revoke')
            );
          })
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
      const streakBreakdown = el('p', { class: 'account-danger-note' });

      const guessSection = el(
        'section',
        { class: 'panel account-panel' },
        el('h2', { class: 'panel-title' }, 'Guess history'),
        historyStats,
        streakBreakdown,
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

      // --- public profile: bio + avatar (Track B · B001) -------------------
      const avatarPreview = el('img', { class: 'account-avatar', alt: 'Your avatar', hidden: true });
      const bioInput = el('textarea', { id: 'account-bio', maxlength: String(BIO_MAX_CHARS), rows: '3', placeholder: 'A short bio…', 'aria-describedby': 'account-bio-count' });
      const bioCount = el('p', { class: 'account-danger-note', id: 'account-bio-count', 'aria-live': 'polite' });
      const avatarFile = el('input', { type: 'file', id: 'account-avatar-file', accept: 'image/jpeg,image/png,image/webp', 'aria-describedby': 'account-avatar-status' });
      const avatarStatus = el('p', { class: 'account-danger-note', id: 'account-avatar-status', 'aria-live': 'polite' });
      const removeAvatarButton = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Remove avatar');
      const profileSaveButton = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save profile');
      const profileForm = el(
        'form',
        { class: 'account-form' },
        el(
          'div',
          { class: 'account-avatar-row' },
          avatarPreview,
          el('div', { class: 'field' }, el('label', { for: 'account-avatar-file' }, 'Avatar (JPEG, PNG, or WebP, resized to 256 px)'), avatarFile)
        ),
        avatarStatus,
        el('div', { class: 'field' }, el('label', { for: 'account-bio' }, 'Bio'), bioInput, bioCount),
        profileSaveButton,
        removeAvatarButton
      );
      const profileSection = el(
        'section',
        { class: 'panel account-panel' },
        el('h2', { class: 'panel-title' }, 'Public profile'),
        el(
          'p',
          { class: 'account-danger-note' },
          'Your bio and avatar show on your public page. Email and sign-in details never do.'
        ),
        profileForm
      );
      let pendingAvatar = undefined; // undefined = keep, null = remove, string = new data URL

      async function refreshProfile() {
        let profile = null;
        try {
          profile = await getProfile();
        } catch {
          profile = null;
        }
        bioInput.value = (profile && profile.bio) || '';
        pendingAvatar = undefined;
        if (profile && profile.avatar) {
          avatarPreview.src = profile.avatar;
          avatarPreview.hidden = false;
          avatarStatus.textContent = 'Custom avatar shown on your public page.';
        } else {
          avatarPreview.src = initialAvatarDataUrl(session.user.username);
          avatarPreview.hidden = false;
          avatarStatus.textContent = 'Generated initial avatar — upload an image to replace it.';
        }
        removeAvatarButton.hidden = !(profile && profile.avatar);
        updateBioCount();
      }

      function updateBioCount() {
        bioCount.textContent = bioInput.value.length + ' / ' + BIO_MAX_CHARS;
      }
      bioInput.addEventListener('input', updateBioCount);

      avatarFile.addEventListener('change', async () => {
        if (!avatarFile.files || !avatarFile.files[0]) return;
        const file = avatarFile.files[0];
        // Pre-check before resize: the server caps the stored image at 150 KB.
        if (file.size > 2 * 1024 * 1024) {
          avatarStatus.textContent = 'That image is over 2 MB. Pick a smaller image — it will be resized to 256 px.';
          return;
        }
        avatarStatus.textContent = 'Resizing image…';
        try {
          pendingAvatar = await resizeImageToDataUrl(avatarFile.files[0], AVATAR_MAX_DIM);
          avatarPreview.src = pendingAvatar;
          avatarPreview.hidden = false;
          avatarStatus.textContent = 'New avatar ready. Save profile to publish it.';
        } catch {
          avatarStatus.textContent = 'Could not read that image. Try a JPEG, PNG, or WebP file.';
        }
      });
      removeAvatarButton.addEventListener('click', () => {
        pendingAvatar = null;
        avatarPreview.src = initialAvatarDataUrl(session.user.username);
        avatarPreview.hidden = false;
        avatarStatus.textContent = 'Custom avatar will be removed on save (generated initial will show).';
      });
      profileForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const next = await updateProfile({
            bio: bioInput.value.trim() || null,
            avatar: pendingAvatar === undefined ? undefined : pendingAvatar,
          });
          bioInput.value = (next && next.bio) || '';
          pendingAvatar = undefined;
          if (next && next.avatar) {
            avatarPreview.src = next.avatar;
            avatarPreview.hidden = false;
          } else {
            avatarPreview.src = initialAvatarDataUrl(session.user.username);
            avatarPreview.hidden = false;
          }
          removeAvatarButton.hidden = !(next && next.avatar);
          avatarStatus.textContent = 'Profile saved.';
          setStatus(status, 'Profile saved.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not save your profile.', 'error');
        }
      });

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
        streakBreakdown.textContent =
          'Anime streak ' + summary.byMedia.anime.currentStreak +
          ' · Manga streak ' + summary.byMedia.manga.currentStreak +
          ' (best ' + Math.max(summary.byMedia.anime.bestStreak, summary.byMedia.manga.bestStreak) + ')';
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
      const oauthActions = el('div', { class: 'account-oauth-actions' });

      const body = el(
        'div',
        { class: 'account-stack' },
        el(
          'section',
          { class: 'panel account-panel' },
          el('h2', { class: 'panel-title' }, 'Overview'),
          el(
            'dl',
            { class: 'account-details' },
            el('div', { class: 'account-detail' }, el('dt', {}, 'Username'), el('dd', {}, session.user.username)),
            el('div', { class: 'account-detail' }, el('dt', {}, 'Email'), el('dd', {}, session.user.email, ' ', verifiedBadge)),
            el('div', { class: 'account-detail' }, el('dt', {}, 'Member since'), el('dd', {}, new Date(session.user.createdAt).toLocaleDateString()))
          ),
          el('div', { class: 'account-verify-row' }, resendButton)
        ),
        profileSection,
        el(
          'section',
          { class: 'panel account-panel' },
          el(
            'div',
            { class: 'account-subsection', id: 'account-oauth-row' },
            el('h2', { class: 'panel-title' }, 'Google sign-in'),
            el('p', { class: 'account-danger-note' }, session.user.oauthProvider === 'google' ? 'Google is linked. You can unlink with your password below.' : 'Link Google to sign in without a password.'),
            oauthActions,
            el(
              'div',
              { class: 'field' },
              el('label', { for: 'account-oauth-password' }, 'Password (to unlink)'),
              el('input', { type: 'password', id: 'account-oauth-password', autocomplete: 'current-password', maxlength: '128' })
            )
          ),
          el('div', { class: 'account-subsection' }, el('h2', { class: 'panel-title' }, 'Change password'), changeForm),
          el(
            'div',
            { class: 'account-subsection' },
            el('h2', { class: 'panel-title' }, 'Reset by email'),
            el(
              'p',
              { class: 'account-danger-note' },
              'We email a one-hour reset link. The request answers the same whether or not the email exists.'
            ),
            resetForm
          )
        ),
        sessionsSection,
        guessSection,
        el(
          'section',
          { class: 'panel account-panel' },
          el('div', { class: 'account-subsection' }, el('h2', { class: 'panel-title' }, 'Your data'), exportButton),
          el(
            'div',
            { class: 'account-subsection' },
            el('h2', { class: 'panel-title' }, 'Danger zone'),
            el(
              'p',
              { class: 'account-danger-note' },
              'Deleting your account removes your credentials, synced preferences, templates, and guess progress. This cannot be undone.'
            ),
            el('div', { class: 'field account-danger-field' }, el('label', { for: 'account-delete-password' }, 'Confirm with your password'), confirmPassword),
            deleteButton
          ),
          el('div', { class: 'account-subsection' }, el('h2', { class: 'panel-title' }, 'Session'), logoutButton),
          status
        )
      );

      render(root, heading, body);
      refreshSessions();
      refreshHistory();
      refreshProfile();
      // OAuth link/unlink actions (providers fetched, button hidden when off).
      listAuthProviders()
        .then((providers) => {
          const google = providers.find((p) => p.provider === 'google' && p.enabled);
          if (!google) {
            oauthActions.hidden = true;
            return;
          }
          if (session.user.oauthProvider === 'google') {
            const unlinkButton = el('button', { class: 'btn btn-danger btn-sm', type: 'button' }, 'Unlink Google');
            unlinkButton.addEventListener('click', async () => {
              const pw = document.getElementById('account-oauth-password');
              unlinkButton.disabled = true;
              try {
                await unlinkGoogle(pw && pw.value ? pw.value : '');
                if (pw) pw.value = '';
                setStatus(status, 'Google unlinked.', 'info');
                renderPage();
              } catch (error) {
                setStatus(status, error instanceof AuthError ? error.message : 'Could not unlink Google.', 'error');
              } finally {
                unlinkButton.disabled = false;
              }
            });
            render(oauthActions, unlinkButton);
          } else {
            render(oauthActions, el('a', { class: 'btn btn-outline btn-sm', href: googleStartUrl('link') }, 'Link Google'));
          }
        })
        .catch(() => {
          oauthActions.hidden = true;
        });

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
        revokeAllButton.disabled = true;
        try {
          await revokeAllSessions();
          window.location.hash = '#/card';
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not sign out everywhere.', 'error');
          revokeAllButton.disabled = false;
        }
      });

      resendButton.addEventListener('click', async () => {
        resendButton.disabled = true;
        try {
          await resendVerification();
          setStatus(status, 'Confirmation email sent.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not resend the email.', 'error');
        } finally {
          resendButton.disabled = false;
        }
      });

      changeForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const btn = changeForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await changePassword(currentPassword.value, newPassword.value);
          currentPassword.value = '';
          newPassword.value = '';
          setStatus(status, 'Password changed. Your other sessions were signed out.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not change the password.', 'error');
        } finally {
          btn.disabled = false;
        }
      });

      resetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const btn = resetForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await requestPasswordReset(resetEmail.value.trim());
          setStatus(status, 'If that email has an account, a reset link is on its way.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not request a reset.', 'error');
        } finally {
          btn.disabled = false;
        }
      });

      exportButton.addEventListener('click', async () => {
        exportButton.disabled = true;
        try {
          await exportData();
          setStatus(status, 'Your data export downloaded.', 'info');
        } catch (error) {
          setStatus(status, error instanceof AuthError ? error.message : 'Could not export your data.', 'error');
        } finally {
          exportButton.disabled = false;
        }
      });

      let deleteArmed = false;
      deleteButton.addEventListener('click', async () => {
        if (!confirmPassword.value) {
          setStatus(status, 'Enter your password to delete your account.', 'error');
          confirmPassword.focus();
          return;
        }
        if (!deleteArmed) {
          deleteArmed = true;
          deleteButton.textContent = 'Click again to confirm delete';
          setStatus(status, 'Click “Delete my account” again within 30 seconds to confirm.', 'warn');
          setTimeout(() => {
            deleteArmed = false;
            deleteButton.textContent = 'Delete my account';
          }, 30000);
          return;
        }
        deleteButton.disabled = true;
        try {
          await deleteAccount(confirmPassword.value);
          window.location.hash = '#/card';
        } catch (error) {
          deleteArmed = false;
          deleteButton.textContent = 'Delete my account';
          setStatus(status, error instanceof AuthError ? error.message : 'Could not delete the account.', 'error');
        } finally {
          confirmPassword.value = '';
          deleteButton.disabled = false;
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
