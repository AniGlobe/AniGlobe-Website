import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_SIZE, initialAvatarDataUrl } from '../src/domain/avatar.js';

test('initial avatar is deterministic per username', () => {
  assert.equal(initialAvatarDataUrl('alice'), initialAvatarDataUrl('alice'));
});

test('initial avatar differs across usernames (hue varies)', () => {
  assert.notEqual(initialAvatarDataUrl('alice'), initialAvatarDataUrl('bob'));
});

test('initial avatar is an SVG data URL with initials', () => {
  const url = initialAvatarDataUrl('sakura_fan');
  assert.equal(url.startsWith('data:image/svg+xml;'), true);
  const svg = decodeURIComponent(url.split(',')[1]);
  assert.equal(svg.includes('<svg'), true);
  assert.equal(svg.includes('SF'), true, 'two-word initials');
  assert.equal(AVATAR_SIZE, 96);
});

test('initial avatar is case-insensitive and handles empty input', () => {
  assert.equal(initialAvatarDataUrl('Alice'), initialAvatarDataUrl('alice'));
  assert.equal(initialAvatarDataUrl('').startsWith('data:image/svg+xml;'), true);
});
