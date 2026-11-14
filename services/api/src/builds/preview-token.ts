import { createHmac, timingSafeEqual } from 'node:crypto';

const ticketPattern = /^[1-9]\d{0,15}$/u;

type Claims = { ticket: string; grant: string };

export function mintPreviewToken(secret: string, ticket: string, grant: string): string {
  const payload = Buffer.from(JSON.stringify({ ticket, grant })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`preview:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyPreviewToken(token: string, secret: string): Claims | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac('sha256', secret).update(`preview:${payload}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims;
    if (
      typeof claims.ticket !== 'string' ||
      !ticketPattern.test(claims.ticket) ||
      typeof claims.grant !== 'string' ||
      !/^[0-9a-f-]{36}$/u.test(claims.grant)
    )
      return null;
    return claims;
  } catch {
    return null;
  }
}
