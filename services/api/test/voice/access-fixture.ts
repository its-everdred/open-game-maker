import { schema } from '@ogm/db';
import { ids, worked as budgetWorked } from '../budget/fixture.js';

export function worked() {
  const deps = budgetWorked();
  const now = new Date('2026-10-31T20:00:00.000Z');
  for (const [id, email, role] of [
    [ids.creator, 'c@example.test', 'maker'],
    [ids.other, 'o@example.test', 'maker'],
    [ids.admin, 'a@example.test', 'admin'],
  ] as const) {
    deps.db
      .insert(schema.user)
      .values({ id, email, name: id, emailVerified: true, createdAt: now, updatedAt: now })
      .run();
    deps.db.insert(schema.allowedUsers).values({ email, role, addedBy: 'test', addedAt: now.toISOString() }).run();
  }
  return deps;
}
