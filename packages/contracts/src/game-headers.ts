const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * The response headers the games host sends with every game file. Local servers and captures use the same headers, so
 * a build the production CSP refuses also fails locally.
 */
export function gameHeaders(appOrigin: string): Readonly<Record<string, string>> {
  if (appOrigin.length === 0 || /[;\r\n]/u.test(appOrigin)) {
    throw new Error('app origin must contain only CSP origin sources');
  }

  const contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self' blob: data:",
    "worker-src 'self' blob:",
    `frame-ancestors ${appOrigin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');

  return {
    'Cache-Control': IMMUTABLE_CACHE,
    'Content-Security-Policy': contentSecurityPolicy,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}
