import { expect, it } from 'vitest';
import { isReviewAdmin } from '../../src/games/review-admin.js';
import { makeDeps } from '../helpers.js';

it('recognizes an allow-list admin under the maintainer role and revokes access on demotion', () => {
  const deps = makeDeps();
  deps.sqlite
    .prepare('INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('maintainer', 'Person', 'admin@example.test', 1, 1, 1);
  deps.sqlite
    .prepare('INSERT INTO allowed_users (email, role, added_by, added_at) VALUES (?, ?, ?, ?)')
    .run('admin@example.test', 'admin', 'test', '2026-01-01');
  const principal = {
    kind: 'user' as const,
    userId: 'maintainer',
    familyId: 'other',
    platformRole: 'maintainer' as const,
    capability: 'creator' as const,
  };
  expect(isReviewAdmin(deps, principal)).toBe(true);
  deps.sqlite.prepare("UPDATE allowed_users SET role = 'maker' WHERE email = ?").run('admin@example.test');
  expect(isReviewAdmin(deps, principal)).toBe(false);
});
