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
    el('input', { type: 'text', id: 'auth-username', name: 'username', autocomplete: 'username', maxlength: '32' }),
    el('p', { class: 'field-error', id: 'auth-username-error', hidden: true })
  );
  const emailField = el(
    'div',
    { class: 'field auth-field', hidden: true },
    el('label', { for: 'auth-email' }, 'Email'),
    el('input', { type: 'email', id: 'auth-email', name: 'email', autocomplete: 'email', maxlength: '254' }),
    el('p', { class: 'field-error', id: 'auth-email-error', hidden: true })
  );
  const identifierField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-identifier' }, 'Username or email'),
    el('input', { type: 'text', id: 'auth-identifier', name: 'identifier', autocomplete: 'username' }),
    el('p', { class: 'field-error', id: 'auth-identifier-error', hidden: true })
  );
  const passwordField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-password' }, 'Password'),
    el('input', { type: 'password', id: 'auth-password', name: 'password', autocomplete: 'current-password', maxlength: '128' }),
    el('p', { class: 'field-error', id: 'auth-password-error', hidden: true })
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

  let justRegisteredEmail = null;

  function clearFieldErrors() {
    for (const input of dialog.querySelectorAll('input')) input.removeAttribute('aria-invalid');
    for (const el of dialog.querySelectorAll('.field-error')) {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function showFieldError(name, message) {
    const input = document.getElementById('auth-' + name);
    const errorEl = document.getElementById('auth-' + name + '-error');
    if (input) input.setAttribute('aria-invalid', 'true');
    if (errorEl) {
      errorEl.textContent = String(message);
      errorEl.hidden = false;
    }
    if (input && errorEl) input.setAttribute('aria-describedby', errorEl.id);
  }

  function paint() {
    justRegisteredEmail = null;
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
    modeToggle.hidden = false;
    form.replaceChildren(
      isLogin ? identifierField : usernameField,
      isLogin ? null : emailField,
      passwordField,
      status,
      submit
    );
    setStatus(status, '', 'info');
    clearFieldErrors();
  }

  function fieldErrors(details) {
    if (!details) return;
    const fields = details.fields || {};
    for (const [name, message] of Object.entries(fields)) {
      showFieldError(name, message);
    }
    if (details.field) {
      showFieldError(details.field, details.message || 'Check this field.');
    }
  }

  async function submitForm(event) {
    event.preventDefault();
    if (justRegisteredEmail) {
      const email = justRegisteredEmail;
      justRegisteredEmail = null;
      closeDialog();
      window.location.hash = '#/account';
      return;
    }
    submit.disabled = true;
    try {
      if (mode === 'login') {
        const identifier = document.getElementById('auth-identifier').value.trim();
        const password = document.getElementById('auth-password').value;
        await login({ identifier, password });
        closeDialog();
      } else {
        const username = document.getElementById('auth-username').value.trim();
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        await register({ username, email, password });
        justRegisteredEmail = email;
        clearFieldErrors();
        title.textContent = 'Check your inbox';
        subtitle.textContent = 'We sent a confirmation link to ' + email + '. Open your account page when you are ready — the badge flips to Verified after you click it.';
        setStatus(status, 'Account created.', 'success');
        submit.textContent = 'Open account page';
        modeToggle.hidden = true;
        submit.focus();
      }
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
