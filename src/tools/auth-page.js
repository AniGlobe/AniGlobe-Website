/**
 * Standalone auth pages: #/login and #/signup
 * Replaces the former dialog popup. Forms mirror the dialog's validation,
 * field errors, and Google button, but live as pages with back links.
 */

import { el, render, setStatus } from '../lib.js';
import { AuthError, googleStartUrl, listAuthProviders, login, register } from '../auth.js';
import { getSession } from '../auth.js';

function buildAuthCard(mode) {
  const isLogin = mode === 'login';
  const title = el('h1', { class: 'auth-page-title' }, isLogin ? 'Log in' : 'Create your account');
  const subtitle = el(
    'p',
    { class: 'auth-page-subtitle' },
    isLogin
      ? 'Your Wrapped preferences, templates, and daily streaks sync to your account.'
      : 'Pick a username and email. We never share them, and profile searches still come from public lists.'
  );
  const status = el('div', { class: 'status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const submit = el('button', { class: 'btn btn-primary auth-submit', type: 'submit' }, isLogin ? 'Log in' : 'Create account');
  const googleButton = el('a', { class: 'btn btn-outline auth-google', href: googleStartUrl('login'), hidden: true }, 'Continue with Google');

  const usernameField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-username' }, 'Username'),
    el('input', { type: 'text', id: 'auth-username', autocomplete: 'username', maxlength: '32' }),
    el('p', { class: 'field-error', id: 'auth-username-error', hidden: true })
  );
  const emailField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-email' }, 'Email'),
    el('input', { type: 'email', id: 'auth-email', autocomplete: 'email', maxlength: '254' }),
    el('p', { class: 'field-error', id: 'auth-email-error', hidden: true })
  );
  const identifierField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-identifier' }, 'Username or email'),
    el('input', { type: 'text', id: 'auth-identifier', autocomplete: 'username' }),
    el('p', { class: 'field-error', id: 'auth-identifier-error', hidden: true })
  );
  const passwordField = el(
    'div',
    { class: 'field auth-field' },
    el('label', { for: 'auth-password' }, 'Password'),
    el('input', { type: 'password', id: 'auth-password', autocomplete: isLogin ? 'current-password' : 'new-password', maxlength: '128' }),
    el('p', { class: 'field-error', id: 'auth-password-error', hidden: true })
  );

  const form = el(
    'form',
    { class: 'auth-form', novalidate: true },
    isLogin ? identifierField : usernameField,
    isLogin ? null : emailField,
    passwordField,
    status,
    submit
  );

  function clearFieldErrors() {
    for (const input of form.querySelectorAll('input')) input.removeAttribute('aria-invalid');
    for (const el of form.querySelectorAll('.field-error')) {
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

  let justRegisteredEmail = null;

  const card = el(
    'section',
    { class: 'panel auth-page-card' },
    el('div', { class: 'auth-page-head' }, title, subtitle),
    form,
    googleButton,
    el(
      'p',
      { class: 'auth-dialog-foot' },
      isLogin
        ? [el('span', {}, 'New here? '), el('a', { href: '#/signup' }, 'Create an account')]
        : [el('span', {}, 'Already have an account? '), el('a', { href: '#/login' }, 'Log in')]
    ),
    el('p', { class: 'auth-page-back' }, el('a', { class: 'btn btn-quiet btn-sm', href: '#/card' }, 'Back to AniManga Wrapped'))
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (justRegisteredEmail) {
      window.location.hash = '#/account';
      return;
    }
    submit.disabled = true;
    try {
      if (isLogin) {
        const identifier = document.getElementById('auth-identifier').value.trim();
        const password = document.getElementById('auth-password').value;
        await login({ identifier, password });
        setStatus(status, 'Logged in.', 'success');
        window.location.hash = '#/account';
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
        submit.focus();
      }
    } catch (error) {
      const message = error instanceof AuthError ? error.message : 'Could not reach the account server. Check your connection and try again.';
      setStatus(status, message, 'error');
      const details = error instanceof AuthError ? error.details : null;
      if (details) {
        const fields = details.fields || {};
        for (const [name, msg] of Object.entries(fields)) showFieldError(name, msg);
        if (details.field) showFieldError(details.field, details.message || 'Check this field.');
      }
    } finally {
      submit.disabled = false;
    }
  });

  listAuthProviders()
    .then((providers) => {
      googleButton.hidden = !providers.some((p) => p.provider === 'google' && p.enabled);
    })
    .catch(() => {
      googleButton.hidden = true;
    });

  const first = isLogin ? document.getElementById('auth-identifier') : document.getElementById('auth-username');
  if (first) setTimeout(() => first.focus(), 0);

  return card;
}

export function renderAuthPage(root, mode) {
  if (getSession()) {
    window.location.replace('#/account');
    return;
  }
  render(root, el('div', { class: 'auth-page-wrap' }, buildAuthCard(mode)));
}
