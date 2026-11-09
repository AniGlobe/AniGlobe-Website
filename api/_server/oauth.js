/**
 * Google OAuth via openid-client v6 (S256 PKCE).
 * Enabled only when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set.
 * No hard-coded redirect host, callers pass the absolute callback URL
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

let configPromise = null;

async function getConfig() {
  if (!configPromise) {
    configPromise = (async () => {
      const { discovery } = await import('openid-client');
      return discovery(GOOGLE_ISSUER, process.env.GOOGLE_CLIENT_ID);
    })();
  }
  return configPromise;
}

export async function googleAuthorizationUrl(redirectUri, { state, codeChallenge }) {
  const { buildAuthorizationUrl } = await import('openid-client');
  const config = await getConfig();
  const params = {
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
  };
  return buildAuthorizationUrl(config, params).toString();
}

export async function exchangeGoogleCode(redirectUri, { code, codeVerifier }) {
  const { authorizationCodeGrant, fetchUserInfo } = await import('openid-client');
  const config = await getConfig();
  const tokens = await authorizationCodeGrant(config, redirectUri, {
    code,
    code_verifier: codeVerifier,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  });
  const userinfo = await fetchUserInfo(config, tokens.access_token, 'sub');
  return userinfo;
}
