/**
 * Mail transport for transactional email (password reset, verification).
 *
 * Interface: sendMail({ to, subject, text }) -> Promise<void>
 *
 * Default transport is console: the message is logged (dev convenience). To
 * send real mail, swap in an SMTP transport by setting MAIL_TRANSPORT=smtp and
 * the SMTP_* variables — or drop in a hosted-provider SDK here. The API layer
 * never knows which transport is behind the interface.
 */

const SITE_NAME = 'AniGlobe';

function mailFrom() {
  return process.env.MAIL_FROM || 'AniGlobe <no-reply@localhost>';
}

function smtpAvailable() {
  return process.env.MAIL_TRANSPORT === 'smtp';
}

let warned = false;

export async function sendMail({ to, subject, text }) {
  const message = { from: mailFrom(), to, subject, text };

  if (smtpAvailable()) {
    // Intentionally not implemented without a transport dependency: the
    // interface exists so the endpoints work the moment one is configured.
    throw new Error('MAIL_TRANSPORT=smtp is not configured yet. Set up the SMTP transport in server/mail.js.');
  }

  if (!warned) {
    warned = true;
    process.stderr.write('[aniglobe-mail] console transport active: set MAIL_TRANSPORT to send real mail.\n');
  }
  process.stderr.write(`[aniglobe-mail] ${JSON.stringify({ ...message })}\n`);
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
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim())
    || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (typeof forwardedHost === 'string' && forwardedHost.split(',')[0].trim())
    || req.headers.host
    || 'localhost:8080';
  return `${proto}://${host}`;
}
