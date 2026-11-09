/**
 * Mail transport for transactional email (password reset, verification).
 *
 * Interface: sendMail({ to, subject, text }) -> Promise<void>
 *
 * Default transport is console (the message is logged — fine for dev).
 * Set MAIL_TRANSPORT=smtp to send real mail with a standard SMTP provider
 * (Brevo free tier, Resend, SES, Postmark, SendGrid, Mailgun, ...).
 * Required when smtp: SMTP_HOST, MAIL_FROM. PORT/USER/PASS per provider.
 * Local testing without any account: run a catcher (Mailpit or Maildev)
 * and point SMTP_HOST at localhost — no domain needed.
 */

import nodemailer from 'nodemailer';

const SITE_NAME = 'AniGlobe';

function mailFrom() {
  return process.env.MAIL_FROM || 'AniGlobe <no-reply@localhost>';
}

/**
 * Reply-To: the bare address from MAIL_FROM when it uses the
 * "Display Name <address>" form, so replies go to the inbox without the
 * display name. MAIL_REPLY_TO overrides it explicitly.
 */
function mailReplyTo() {
  const override = process.env.MAIL_REPLY_TO;
  if (override) return override;
  const from = mailFrom();
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].trim() : from.trim();
}

let transport = null;
let transportWarned = false;

function smtpTransport() {
  if (transport) return transport;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
    // Short timeouts: a serverless instance must fail fast, not hang for the
    // nodemailer defaults (2 min) waiting on a dead SMTP server.
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  return transport;
}

export async function sendMail({ to, subject, text }) {
  const message = { from: mailFrom(), replyTo: mailReplyTo(), to, subject, text };

  if (process.env.MAIL_TRANSPORT === 'smtp') {
    const transport = smtpTransport();
    if (!transport) {
      throw new Error('MAIL_TRANSPORT=smtp but SMTP_HOST is not set.');
    }
    await transport.sendMail(message);
    return;
  }

  if (!transportWarned) {
    transportWarned = true;
    process.stderr.write('[aniglobe-mail] console transport active: set MAIL_TRANSPORT=smtp (+ SMTP_*) to send real mail.\n');
  }
  // Redact reset/verify URLs (which carry raw tokens) in logs; log only
  // recipient + subject so prod logs never leak usable links.
  const redacted = {
    from: message.from,
    replyTo: message.replyTo,
    to: message.to,
    subject: message.subject,
    text: message.text.replace(/https?:\/\/[^\s]+/g, '[redacted-url]'),
  };
  process.stderr.write(`[aniglobe-mail] ${JSON.stringify(redacted)}\n`);
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('[aniglobe-mail] console transport is not for production — set MAIL_TRANSPORT=smtp.\n');
  }
}

export function resetPasswordMail(to, resetUrl) {
  return {
    to,
    subject: `Reset your ${SITE_NAME} password`,
    text: [
      `We received a request to reset the password for your ${SITE_NAME} account.`,
      '',
      'If this was you, open this link within 1 hour:',
      resetUrl,
      '',
      'If this was not you, ignore this email. Your password has not changed.',
    ].join('\n'),
  };
}

export function verifyEmailMail(to, verifyUrl) {
  return {
    to,
    subject: `Confirm your email for ${SITE_NAME}`,
    text: [
      `Welcome to ${SITE_NAME}. Confirm your email to activate sync and your account page:`,
      '',
      verifyUrl,
      '',
      'This link expires in 24 hours. If you did not create this account, ignore this email.',
    ].join('\n'),
  };
}

export function originOf(req) {
  // Only honour X-Forwarded-* when a trusted reverse proxy sets them.
  // Otherwise an attacker can poison reset/verify links via Host poisoning.
  const trusted = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
  const forwardedProto = trusted ? req.headers['x-forwarded-proto'] : undefined;
  const proto = (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim())
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const forwardedHost = trusted ? req.headers['x-forwarded-host'] : undefined;
  const host = (typeof forwardedHost === 'string' && forwardedHost.split(',')[0].trim())
    || req.headers.host
    || 'localhost:8080';
  const safeProto = proto === 'https' ? 'https' : 'http';
  // Strip any path/query smuggled via a spoofed Host header.
  const safeHost = String(host).split('/')[0].split('?')[0].split('#')[0];
  return `${safeProto}://${safeHost}`;
}
