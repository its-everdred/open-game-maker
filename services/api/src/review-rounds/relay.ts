import { Hono } from 'hono';
import type { ApiBindings, AppDeps } from '../app/types.js';
import { buildRoutes } from '../builds/routes.js';

// The preview relay has already checked the ticket-scoped grant and game/repository binding.
// Reuse the normal submission route so both transports enforce identical track and media rules.
export async function submitRelayedReview(
  deps: AppDeps,
  slug: string,
  repo: string,
  submission: unknown,
): Promise<{ id: string; round: number }> {
  const app = new Hono<ApiBindings>();
  app.use(async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.route(
    '/internal',
    buildRoutes({ daemonForSecret: async () => null, gameForSecret: async () => ({ slug, repo }) }),
  );
  const response = await app.request(`/internal/games/${encodeURIComponent(slug)}/review-rounds`, {
    method: 'POST',
    headers: { authorization: 'Bearer verified-relay', 'content-type': 'application/json' },
    body: JSON.stringify(submission),
  });
  if (!response.ok) throw new Error('review_submission_refused');
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== 'object' ||
    !('id' in data) ||
    typeof data.id !== 'string' ||
    !('round' in data) ||
    typeof data.round !== 'number'
  )
    throw new Error('review_submission_invalid');
  return { id: data.id, round: data.round };
}
