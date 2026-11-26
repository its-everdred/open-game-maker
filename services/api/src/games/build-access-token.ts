import { createHmac, timingSafeEqual } from 'node:crypto';

const prefix = 'gba1';
const lifetimeSeconds = 24 * 60 * 60;
type Claims = { gameId: string; userId: string; familyId: string; sessionId: string; exp: number };

function signature(secret: string, body: string): Buffer {
  return createHmac('sha256', secret).update(`game-build-access:${body}`).digest();
}

export function signBuildAccess(claims: Omit<Claims, 'exp'>, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(now / 1000) + lifetimeSeconds })).toString(
    'base64url',
  );
  const body = `${prefix}.${payload}`;
  return `${body}.${signature(secret, body).toString('base64url')}`;
}

export function verifyBuildAccess(token: string, secret: string, now = Date.now()): Claims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== prefix || !parts[1] || !parts[2]) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = signature(secret, body);
  const supplied = Buffer.from(parts[2], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object') return null;
    const value = claims as Partial<Claims>;
    if (
      typeof value.gameId !== 'string' ||
      typeof value.userId !== 'string' ||
      typeof value.familyId !== 'string' ||
      typeof value.sessionId !== 'string' ||
      typeof value.exp !== 'number' ||
      !Number.isSafeInteger(value.exp) ||
      value.exp * 1000 <= now
    )
      return null;
    return value as Claims;
  } catch {
    return null;
  }
}
