/**
 * Generated initial avatars (replaces empty/generic placeholders).
 *
 * Deterministic SVG identicon: the username is hashed to a hue, the two
 * initials are drawn on a token background. No network, no library —
 * Gravatar would need external fetches (breaks CSP/privacy/offline), and a
 * full DiceBear dependency would break the zero-dep stack. This keeps the
 * same visual idea (a per-user generated face) with one small, tested
 * module. Output is a data URL, allowed by the existing `img-src data:`
 * CSP.
 */

import { hashString } from '../lib.js';

export const AVATAR_SIZE = 96;

function initialsFor(username) {
  const name = String(username || '?').trim();
  if (!name) return '?';
  const words = name.split(/[\s_.-]+/u).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Deterministic data URL for a username. Never throws. */
export function initialAvatarDataUrl(username) {
  const text = String(username || '?');
  const hue = hashString(text.toLowerCase()) % 360;
  const bg = 'hsl(' + hue + ' 45% 32%)';
  const fg = 'hsl(' + hue + ' 70% 88%)';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
    + '<rect width="96" height="96" fill="' + esc(bg) + '"/>'
    + '<text x="48" y="48" dy=".35em" text-anchor="middle" font-family="Inter, system-ui, sans-serif" '
    + 'font-size="40" font-weight="600" fill="' + esc(fg) + '">' + esc(initialsFor(text)) + '</text>'
    + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
