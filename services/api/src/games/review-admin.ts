import type { Principal } from '@ogm/contracts';
import type { AppDeps } from '../app/types.js';

// Maintainer is an independent break-glass role and can mask an allow-list administrator role.
export function isReviewAdmin(deps: AppDeps, principal: Extract<Principal, { kind: 'user' }>): boolean {
  if (principal.platformRole === 'admin') return true;
  if (principal.platformRole !== 'maintainer') return false;
  const row = deps.sqlite
    .prepare(
      `SELECT 1 FROM user u JOIN allowed_users a ON lower(u.email) = a.email
    WHERE u.id = ? AND a.role = 'admin' LIMIT 1`,
    )
    .get(principal.userId);
  return Boolean(row);
}
