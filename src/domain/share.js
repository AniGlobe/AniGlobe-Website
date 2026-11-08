/**
 * Template share links (Track B · B004).
 * A template is a { name, options } pair. The payload is JSON → base64url
 * placed in the URL fragment (`#/card?share=…`) so it never hits the server.
 * Pure helpers, no DOM — unit-testable in Node.
 */

export const SHARE_NAME_MAX = 64;
export const SHARE_PAYLOAD_MAX_BYTES = 4096;
export const SHARE_LINK_MAX_CHARS = 8192;

function toBytes(text) {
  return new TextEncoder().encode(text).length;
}

function b64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const b64 = typeof Buffer !== 'undefined'
    ? Buffer.from(bytes).toString('base64')
    : btoa(binary);
  return b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function b64UrlDecode(text) {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(padded, 'base64'));
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode a template for a share link. Returns the base64url string (not the
 * full URL) so callers build the origin-dependent URL themselves.
 */
export function encodeTemplateShare(template) {
  if (!template || typeof template.name !== 'string' || !template.options || typeof template.options !== 'object') {
    throw new Error('Template must have a name and options.');
  }
  const name = template.name.trim();
  if (!name || name.length > SHARE_NAME_MAX) {
    throw new Error('Template names need 1–64 characters.');
  }
  const json = JSON.stringify({ name, options: template.options });
  if (toBytes(json) > SHARE_PAYLOAD_MAX_BYTES) {
    throw new Error('Template is too large to share.');
  }
  return b64UrlEncode(new TextEncoder().encode(json));
}

export function buildShareUrl(template, origin) {
  const code = encodeTemplateShare(template);
  const url = String(origin).replace(/\/+$/u, '') + '#/card?share=' + code;
  if (url.length > SHARE_LINK_MAX_CHARS) {
    throw new Error('Share link is too long for this template.');
  }
  return url;
}

/** Extract the share code from a hash like `#/card?share=…` (or a raw code). */
export function shareCodeFromHash(hash) {
  const text = String(hash || '');
  const q = text.indexOf('?');
  if (q < 0) return null;
  const params = new URLSearchParams(text.slice(q));
  return params.get('share') || null;
}

export function decodeTemplateShare(code) {
  if (!code || typeof code !== 'string') {
    throw new Error('No share code found.');
  }
  if (code.length > SHARE_LINK_MAX_CHARS) {
    throw new Error('Share link is too long.');
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(code)) {
    throw new Error('That share link looks damaged.');
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64UrlDecode(code)));
  } catch {
    throw new Error('That share link looks damaged.');
  }
  if (!parsed || typeof parsed.name !== 'string' || !parsed.options || typeof parsed.options !== 'object') {
    throw new Error('That share link does not carry a valid template.');
  }
  const name = parsed.name.trim();
  if (!name || name.length > SHARE_NAME_MAX) {
    throw new Error('That share link has an invalid template name.');
  }
  if (toBytes(JSON.stringify(parsed.options)) > SHARE_PAYLOAD_MAX_BYTES) {
    throw new Error('That shared template is too large.');
  }
  return { name, options: parsed.options };
}
