/**
 * Google OAuth via openid-client (S256 PKCE).
 * Enabled only when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set.
 * No hard-coded redirect host — callers pass the absolute callback URL
 * (from GOOGLE_CALLBACK_URL or the request origin).
 */

export const GOOGLE_PROVIDER = 'google';
export const GOOGLE_ISSUER = 'https://accounts.google.com';

export function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function callbackUrl(req) {
  const override = process.env.GOOGLE_CALLBACK_URL;
  if (override) return override;
  const trusted = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
  const proto = trusted && req && req.headers['x-forwarded-proto']
    ? String(req.headers['x-forwarded-proto']).split(',')[0].trim()
    : 'http';
  const host = trusted && req && req.headers['x-forwarded-host']
    ? String(req.headers['x-forwarded-host']).split(',')[0].trim()
    : (req && req.headers.host) || 'localhost:8080';
  const safeHost = String(host).split('/')[0].split('?')[0].split('#')[0];
  return `${proto === 'https' ? 'https' : 'http'}://${safeHost}/api/auth/oauth/google/callback`;
}

let discovery = null;

async function getDiscovery() {
  if (!discovery) {
    const { discovery: disc } = await import('openid-client');
    discovery = disc;
  }
  return discovery;
}

export async function buildGoogleClient(redirectUri) {
  const { Client } = await import('openid-client');
  const disc = await getDiscovery();
  const issuer = await disc(GOOGLE_ISSUER);
  return new Client({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [redirectUri],
    issuer,
  });
}

export async function googleAuthorizationUrl(redirectUri, { state, codeChallenge }) {
  const client = await buildGoogleClient(redirectUri);
  return client.authorizationUrl({
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
}

export async function exchangeGoogleCode(redirectUri, { code, codeVerifier }) {
  const client = await buildGoogleClient(redirectUri);
  const tokens = await client.callback(redirectUri, { code }, { code_verifier: codeVerifier });
  const userinfo = await client.userinfo(tokens.access_token);
  return userinfo;
}
