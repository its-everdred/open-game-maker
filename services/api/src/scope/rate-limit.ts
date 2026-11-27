import { createRateLimiter } from '../auth/rate-limit.js';
import type { AppDeps } from '../app/types.js';

// Scope conversations can start agent work without creating a game. Bound repeated starts without
// charging abandoned drafts against the creator's weekly new-game allowance.
const limiters = new WeakMap<AppDeps, ReturnType<typeof createRateLimiter>>();
export function allowScopeStart(deps: AppDeps, userId: string): boolean {
  let limiter = limiters.get(deps);
  if (!limiter) {
    limiter = createRateLimiter(10);
    limiters.set(deps, limiter);
  }
  return limiter(userId);
}
