/**
 * Account page: who you are, what syncs, change your password, and delete the
 * account. Reached from the topbar account menu (#/account). The page is a
 * plain tool module like the others; it reads the session and talks to the
 * backend only for this page's own mutations.
 */

import { el, render, setStatus } from '../lib.js';
import { AuthError, changePassword, deleteAccount, getSession, logout } from '../auth.js';

export default {
  id: 'account',
  title: 'Account',
  blurb: 'Manage your AniGlobe account.',

  mount(root) {
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

    const currentPassword = el('input', {
      type: 'password', id: 'account-current', autocomplete: 'current-password', maxlength: '128',
    });
    const newPassword = el('input', {
      type: 'password', id: 'account-next', autocomplete: 'new-password', maxlength: '128',
    });
    const changeForm = el(
      'form',
      { class: 'account-form' },
      el('div', { class: 'field' }, el('label', { for: 'account-current' }, 'Current password'), currentPassword),
      el('div', { class: 'field' }, el('label', { for: 'account-next' }, 'New password'), newPassword),
      el('button', { class: 'btn btn-outline', type: 'submit' }, 'Change password')
    );

    const confirmPassword = el('input', {
      type: 'password', id: 'account-delete-password', autocomplete: 'current-password', maxlength: '128',
    });
    const deleteButton = el('button', { class: 'btn btn-danger', type: 'button' }, 'Delete my account');

    const logoutButton = el('button', { class: 'btn btn-outline', type: 'button' }, 'Log out');

    const body = el(
      'section',
      { class: 'panel account-panel' },
      el(
        'dl',
        { class: 'account-details' },
        el('div', { class: 'account-detail' }, el('dt', {}, 'Username'), el('dd', {}, session.user.username)),
        el('div', { class: 'account-detail' }, el('dt', {}, 'Email'), el('dd', {}, session.user.email)),
        el('div', { class: 'account-detail' }, el('dt', {}, 'Member since'), el('dd', {}, new Date(session.user.createdAt).toLocaleDateString()))
      ),
      el('h2', { class: 'panel-title' }, 'Change password'),
      changeForm,
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
    );

    render(root, heading, body);

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
  },
};
