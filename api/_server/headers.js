/**
 * Response security headers, shared by the local dev server and the Vercel
 * function. On Vercel the same set is also declared in vercel.json so
 * statically served files (which bypass the function) carry it too.
 *
 * Content Security Policy. The page loads same-origin scripts/styles, Google
 * Fonts, the Typekit kit, the Jikan/AniList APIs, and the html-to-image CDN.
 * Everything else is denied. Served enforced by default; flip
 * `ENFORCE_CSP=0` to soften to report-only while debugging fonts/vendors.
 */

export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' https://fonts.googleapis.com https://use.typekit.net",
  "font-src 'self' https://fonts.gstatic.com https://use.typekit.net",
  "img-src 'self' data: https://media.kitsu.io",
  "connect-src 'self' https://jikan.lucashdo.com https://graphql.anilist.co",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
].join('; ');

export function securityHeaders() {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  if (process.env.ENFORCE_CSP === '0') {
    headers['Content-Security-Policy-Report-Only'] = CSP;
  } else {
    headers['Content-Security-Policy'] = CSP;
  }
  if (process.env.NODE_ENV === 'production') {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}
