import type { Context, MiddlewareHandler } from 'hono';

import type { Principal } from '@ogm/contracts';

import { HttpError } from './errors.js';
import { sameSecret } from './internal-auth.js';
import { verifyJobToken } from './job-token.js';
import type { ApiBindings } from './types.js';

type ServiceName = Extract<Principal, { kind: 'service' }>['service'];
const SERVICES: readonly ServiceName[] = ['intake', 'voice-host', 'commit', 'builder', 'rooms', 'repair'];

function bearer(c: Context): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
  return match ? match[1] : null;
}

// Resolves `c.var.principal`: the internal service token, then a gmj1 job token, then every
// registered resolver in order; anything else is anonymous (fail closed).
export function principalMiddleware(): MiddlewareHandler<ApiBindings> {
  return async (c, next) => {
    const deps = c.get('deps');
    const token = bearer(c);
    let principal: Principal | null = null;

    if (token !== null && sameSecret(token, deps.config.internalToken)) {
      const service = c.req.header('x-ogm-service') as ServiceName | undefined;
      if (!service || !SERVICES.includes(service)) throw new HttpError(401, 'invalid_service');
      principal = { kind: 'service', service };
    } else if (token?.startsWith('gmj1.')) {
      const claims = verifyJobToken(token, deps.config.jobTokenSecret);
      if (claims) principal = { kind: 'job', jobId: claims.jobId, gameId: claims.gameId, familyId: claims.familyId };
    }

    for (const resolve of deps.registry.principalResolvers) {
      if (principal) break;
      principal = await resolve(c);
    }

    c.set('principal', principal ?? { kind: 'anonymous' });
    await next();
    if (principal?.kind === 'user') {
      c.header('x-ogm-user-id', principal.userId);
      c.header('x-ogm-capability', principal.capability);
      c.header('x-ogm-platform-role', principal.platformRole);
    }
  };
}

export function requirePrincipal<K extends Exclude<Principal['kind'], 'anonymous'>>(
  c: Context<ApiBindings>,
  kinds: readonly K[],
): Extract<Principal, { kind: K }> {
  const principal = c.get('principal');
  if (principal.kind === 'anonymous') throw new HttpError(401, 'unauthenticated');
  if (!(kinds as readonly string[]).includes(principal.kind)) throw new HttpError(403, 'forbidden');
  return principal as Extract<Principal, { kind: K }>;
}
