/**
 * Email link pages: #/verify?token=... and #/reset?token=...
 *
 * Rendered by the shell directly (not through the tool registry) when the
 * hash matches. Each page reads its token, calls the backend once, and shows
 * the outcome.
 */

import { el, render } from '../lib.js';
import { AuthError, confirmPasswordReset, confirmVerification } from '../auth.js';

function tokenFromHash() {
  const search = (window.location.hash && window.location.hash.includes('?'))
    ? window.location.hash.slice(window.location.hash.indexOf('?'))
    : '';
  return new URLSearchParams(search).get('token') || '';
}

function pageChrome(root, heading, lead, children) {
  render(
    root,
    el(
      'div',
      { class: 'tool-head' },
      el('h1', {}, heading),
      el('p', {}, lead)
    ),
    el('section', { class: 'panel auth-link-panel' }, ...children)
  );
}

export function renderVerify(root) {
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const token = tokenFromHash();

  pageChrome(
    root,
    'Confirm your email',
    'One click links this inbox to your AniGlobe account.',
    [
      status,
      el(
        'p',
        { style: { marginTop: '16px' } },
        el('a', { class: 'btn btn-primary', href: '#/account' }, 'Go to my account')
      ),
    ]
  );

  if (!token) {
    status.textContent = 'This link has no token. Request a new one from the account page.';
    status.dataset.tone = 'error';
    return;
  }

  status.textContent = 'Confirming…';
  confirmVerification(token)
    .then(() => {
      status.textContent = 'Email confirmed. Your account page now shows the verified badge.';
      status.dataset.tone = 'success';
    })
    .catch((error) => {
      status.textContent = error instanceof AuthError
        ? error.message
        : 'Could not confirm the email. Check your connection and try again.';
      status.dataset.tone = 'error';
    });
}

export function renderReset(root) {
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const token = tokenFromHash();

  const next = el('input', { type: 'password', id: 'reset-next', autocomplete: 'new-password', maxlength: '128' });
  const confirm = el('input', { type: 'password', id: 'reset-confirm', autocomplete: 'new-password', maxlength: '128' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Set new password');

  const form = el(
    'form',
    { class: 'auth-form auth-link-form' },
    el('div', { class: 'field auth-field' }, el('label', { for: 'reset-next' }, 'New password'), next),
    el('div', { class: 'field auth-field' }, el('label', { for: 'reset-confirm' }, 'Confirm new password'), confirm),
    status,
    submit
  );

  pageChrome(
    root,
    'Reset your password',
    'Links expire after one hour and work once.',
    [
      form,
      el(
        'p',
        { style: { marginTop: '16px' } },
        el('a', { class: 'btn btn-quiet', href: '#/card' }, 'Back to AniManga Wrapped')
      ),
    ]
  );

  if (!token) {
    status.textContent = 'This link has no token. Request a new one from the login dialog.';
    status.dataset.tone = 'error';
    submit.disabled = true;
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (next.value !== confirm.value) {
      status.textContent = 'The two passwords do not match.';
      status.dataset.tone = 'error';
      return;
    }
    submit.disabled = true;
    try {
      await confirmPasswordReset(token, next.value);
      status.textContent = 'Password reset. You can log in with the new one now.';
      status.dataset.tone = 'success';
    } catch (error) {
      status.textContent = error instanceof AuthError
        ? error.message
        : 'Could not reset the password. Check your connection and try again.';
      status.dataset.tone = 'error';
    } finally {
      submit.disabled = false;
    }
  });
}
