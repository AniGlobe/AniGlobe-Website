/**
 * Password hashing via Node's built-in scrypt.
 *
 * Format (self-describing, algorithm agility): scrypt$N$r$p$salt$hash
 *   N=16384, r=8, p=1, 64-byte key — the OWASP baseline for scrypt.
 *
 * scrypt is memory-hard, which makes bulk credential cracking expensive.
 * No native dependency needed; this is the platform-standard primitive.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES, SCRYPT_PARAMS);
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export function verifyPassword(password, storedHash) {
  try {
    const [algorithm, nStr, rStr, pStr, saltB64, hashB64] = String(storedHash).split('$');
    if (algorithm !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Dummy verification target used when the username does not exist, so the
 * login endpoint spends the same CPU either way and does not leak account
 * existence through timing.
 */
const DUMMY_HASH = hashPassword('aniglobe-dummy-credential');

export function dummyVerify(password) {
  return verifyPassword(password, DUMMY_HASH);
}
