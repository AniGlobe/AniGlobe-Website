/**
 * The sign-in dialog: one native <dialog> hosting the login and register
 * forms. Both forms submit to the backend and close on success; the shell
 * re-renders the topbar from the session event.
 */

import { el, render, setStatus } from '../lib.js';
import { AuthError, login, register } from '../auth.js';

const MODES = ['login', 'register'];

export function createAuthDialog() {
  let mode = 'login';
  let lastTrigger = null;

  const title = el('h2', { id: 'auth-dialog-title', class: 'auth-dialog-title' }, 'Log in');
  const subtitle = el('p', { class: 'auth-dialog-subtitle' }, 'Your Wrapped preferences, templates, and daily streaks sync to your account.');

  const usernameField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-username' }, 'Username'),
    el('input', { type: 'text', id: 'auth-username', name: 'username', autocomplete: 'username', maxlength: '32' })
  );
  const emailField = el(
    'div',
    { class: 'field auth-field', hidden: true },
    el('label', { for: 'auth-email' }, 'Email'),
    el('input', { type: 'email', id: 'auth-email', name: 'email', autocomplete: 'email', maxlength: '254' })
  );
  const identifierField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-identifier' }, 'Username or email'),
    el('input', { type: 'text', id: 'auth-identifier', name: 'identifier', autocomplete: 'username' })
  );
  const passwordField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-password' }, 'Password'),
    el('input', { type: 'password', id: 'auth-password', name: 'password', autocomplete: 'current-password', maxlength: '128' })
  );
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const submit = el('button', { class: 'btn btn-primary auth-submit', type: 'submit' }, 'Log in');
  const form = el('form', { class: 'auth-form', novalidate: true }, status, submit);

  const closeButton = el('button', { class: 'auth-dialog-close', type: 'button', 'aria-label': 'Close sign-in' }, '×');
  const modeToggle = el('button', { class: 'btn btn-quiet auth-mode-toggle', type: 'button' }, 'Create an account');

  const dialog = el(
    'dialog',
    { class: 'auth-dialog', 'aria-labelledby': 'auth-dialog-title' },
    el(
      'div',
      { class: 'auth-dialog-head' },
      el('div', {}, title, subtitle),
      closeButton
    ),
    form,
    el('p', { class: 'auth-dialog-foot' }, modeToggle)
  );

  function paint() {
    const isLogin = mode === 'login';
    title.textContent = isLogin ? 'Log in' : 'Create your account';
    subtitle.textContent = isLogin
      ? 'Your Wrapped preferences, templates, and daily streaks sync to your account.'
      : 'Pick a username and email. We never share them, and profile searches still come from public lists.';
    usernameField.hidden = isLogin;
    emailField.hidden = isLogin;
    identifierField.hidden = !isLogin;
    passwordField.querySelector('input').setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
    submit.textContent = isLogin ? 'Log in' : 'Create account';
    modeToggle.textContent = isLogin ? 'New here? Create an account' : 'Already have an account? Log in';
    form.replaceChildren(
      isLogin ? identifierField : usernameField,
      isLogin ? null : emailField,
      passwordField,
      status,
      submit
    );
    setStatus(status, '', 'info');
  }

  function fieldErrors(details) {
    if (!details) return;
    const fields = details.fields || {};
    const mapping = {
      username: document.getElementById('auth-username'),
      email: document.getElementById('auth-email'),
      identifier: document.getElementById('auth-identifier'),
      password: document.getElementById('auth-password'),
    };
    for (const [name, message] of Object.entries(fields)) {
      const input = mapping[name];
      if (input) input.setAttribute('aria-invalid', 'true');
    }
    if (details.field && mapping[details.field]) {
      mapping[details.field].setAttribute('aria-invalid', 'true');
    }
  }

  async function submitForm(event) {
    event.preventDefault();
    submit.disabled = true;
    try {
      if (mode === 'login') {
        const identifier = document.getElementById('auth-identifier').value.trim();
        const password = document.getElementById('auth-password').value;
        await login({ identifier, password });
      } else {
        const username = document.getElementById('auth-username').value.trim();
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        await register({ username, email, password });
        setStatus(status, 'Account created. We sent a confirmation link to ' + email + ' — confirm your email to unlock the account page.', 'success');
        await new Promise((resolve) => setTimeout(resolve, 1600));
      }
      closeDialog();
    } catch (error) {
      const message = error instanceof AuthError ? error.message : 'Could not reach the account server. Check your connection and try again.';
      setStatus(status, message, 'error');
      fieldErrors(error instanceof AuthError ? error.details : null);
    } finally {
      submit.disabled = false;
    }
  }

  function openDialog(nextMode = 'login', trigger = null) {
    mode = MODES.includes(nextMode) ? nextMode : 'login';
    lastTrigger = trigger;
    paint();
    if (!dialog.open) dialog.showModal();
    passwordField.querySelector('input').focus();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
    if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
  }

  form.addEventListener('submit', submitForm);
  closeButton.addEventListener('click', closeDialog);
  modeToggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    paint();
    passwordField.querySelector('input').focus();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener('close', () => {
    passwordField.querySelector('input').value = '';
    if (document.getElementById('auth-identifier')) document.getElementById('auth-identifier').value = '';
    if (document.getElementById('auth-username')) document.getElementById('auth-username').value = '';
    if (document.getElementById('auth-email')) document.getElementById('auth-email').value = '';
  });

  render(dialog, dialog.querySelector('.auth-dialog-head'), form, dialog.querySelector('.auth-dialog-foot'));
  document.body.append(dialog);

  return { open: openDialog };
}

export { MODES };
