import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { notFound, onError } from './errors.js';
import { principalMiddleware } from './principal.js';
import type { ApiBindings, AppDeps } from './types.js';

export { HttpError } from './errors.js';
export { createAppEvents, type AppEventMap, type AppEvents } from './events.js';
export { JOB_TOKEN_TTL_SEC, signJobToken, verifyJobToken } from './job-token.js';
export { requirePrincipal } from './principal.js';
export {
  createRegistry,
  resolveGame,
  type GameInfo,
  type GameResolver,
  type Registry,
  type Resolver,
  type TicketJob,
  type TicketJobResolver,
} from './registry.js';
export { scanRoutes } from './routes-scan.js';
export type { ApiBindings, AppDeps, LogLine } from './types.js';
export { parseBody, parseQuery } from './validate.js';

const requestIdPattern = /^[A-Za-z0-9-]{1,64}$/;
const invitePathSegment = /(\/api\/v1\/(?:invites|join)\/)[^/]+/gi;

function requestLogPath(path: string): string {
  return path.replace(invitePathSegment, '$1:token');
}

// Routes are mounted afterwards by `scanRoutes`, so these middlewares run before every context.
export function createApp(deps: AppDeps): Hono<ApiBindings> {
  const app = new Hono<ApiBindings>();

  app.use(async (c, next) => {
    const started = performance.now();
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && requestIdPattern.test(incoming) ? incoming : randomUUID();
    c.set('requestId', requestId);
    c.set('deps', deps);
    await next();
    c.header('x-request-id', requestId);
    deps.log({
      event: 'request',
      method: c.req.method,
      path: requestLogPath(c.req.path),
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      requestId,
    });
  });
  app.use(principalMiddleware());
  app.onError(onError);
  app.notFound(notFound);

  return app;
}
