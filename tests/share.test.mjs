import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareUrl, decodeTemplateShare, encodeTemplateShare, shareCodeFromHash } from '../src/domain/share.js';

const SAMPLE = {
  name: 'Ember plum',
  options: { theme: 'night', layout: 'story', order: ['stats'], colors: {}, showStats: true },
};

test('share link round-trips a template through base64url with no server storage', () => {
  const code = encodeTemplateShare(SAMPLE);
  assert.match(code, /^[A-Za-z0-9_-]+$/u);
  assert.equal(code.includes('+'), false);
  assert.equal(code.includes('/'), false);
  const back = decodeTemplateShare(code);
  assert.deepEqual(back, SAMPLE);
});

test('buildShareUrl puts the code in the fragment, never a server-visible query', () => {
  const url = buildShareUrl(SAMPLE, 'http://localhost:8080/');
  assert.equal(url.startsWith('http://localhost:8080#/card?share='), true);
  assert.equal(shareCodeFromHash(new URL(url).hash), url.split('share=')[1].split('#')[0] || url.split('share=')[1]);
});

test('shareCodeFromHash returns null without a share param', () => {
  assert.equal(shareCodeFromHash('#/card'), null);
  assert.equal(shareCodeFromHash(''), null);
  assert.equal(shareCodeFromHash('#/card?share=abc123'), 'abc123');
});

test('decode rejects damaged, empty, and wrong-shape links', () => {
  assert.throws(() => decodeTemplateShare(''), /No share code/);
  assert.throws(() => decodeTemplateShare('not base64!!'), /damaged/);
  assert.throws(() => decodeTemplateShare(Buffer.from(JSON.stringify({ foo: 1 })).toString('base64url')), /valid template/);
  assert.throws(() => decodeTemplateShare(Buffer.from(JSON.stringify({ name: '', options: {} })).toString('base64url')), /invalid template name/);
});

test('encode rejects missing options and oversized templates', () => {
  assert.throws(() => encodeTemplateShare({ name: 'X' }), /name and options/);
  assert.throws(() => encodeTemplateShare({ name: SAMPLE.name, options: { blob: 'x'.repeat(5000) } }), /too large/);
  assert.throws(() => encodeTemplateShare({ name: 'x'.repeat(65), options: {} }), /1–64/);
});
