import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@ogm/db';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import { normalizeEmail } from './access.js';
import { invalidateArtifactGrants } from '../artifacts/session-grants.js';

// Platform roles, weakest first. A maker may create and edit games; an admin also manages the
// instance and this list. Players only play. Every role is a signed-in user.
export const ALLOWED_ROLES = ['player', 'maker', 'admin'] as const;
export type AllowedRole = (typeof ALLOWED_ROLES)[number];

// `app_meta` key recording that the boot-time env lists have become rows. It is written once, so a
// later env edit never overrides a change an admin made in the app.
export const ALLOW_LIST_SEEDED_KEY = 'allow_list:seeded';
export const SEEDED_BY = 'env';

export type AllowedUserRow = {
  email: string;
  role: AllowedRole;
  addedBy: string;
  addedAt: string;
  lastSignInAt: string | null;
  name: string | null;
};

export function roleForEmail(db: Db, email: string): AllowedRole | null {
  const row = db
    .select({ role: schema.allowedUsers.role })
    .from(schema.allowedUsers)
    .where(eq(schema.allowedUsers.email, normalizeEmail(email)))
    .get();
  return row?.role ?? null;
}

export function isAllowedEmail(db: Db, email: string): boolean {
  return roleForEmail(db, email) !== null;
}

export function countAllowedUsers(db: Db): number {
  const row = db
    .select({ total: sql<number>`count(*)` })
    .from(schema.allowedUsers)
    .get();
  return row?.total ?? 0;
}

// Rows are appended in one transaction and the seed marker is written with them, so a crash mid-way
// re-runs the whole seed instead of leaving half the list behind. Returns the number of rows written.
export function seedAllowList(
  db: Db,
  input: { allowed: ReadonlySet<string>; maintainers: ReadonlySet<string>; now?: string },
): number {
  const seeded = db
    .select({ key: schema.appMeta.key })
    .from(schema.appMeta)
    .where(eq(schema.appMeta.key, ALLOW_LIST_SEEDED_KEY))
    .get();
  if (seeded) return 0;

  const now = input.now ?? new Date().toISOString();
  // Maintainers are the instance's original admins; everyone else on the old allow list kept the
  // creator access they had, which is this platform's `maker`.
  const rows = new Map<string, AllowedRole>();
  for (const email of input.allowed) rows.set(normalizeEmail(email), 'maker');
  for (const email of input.maintainers) rows.set(normalizeEmail(email), 'admin');
  const values = [...rows.entries()]
    .filter(([email]) => email !== '')
    .map(([email, role]) => ({ email, role, addedBy: SEEDED_BY, addedAt: now }));

  db.transaction((tx) => {
    if (values.length > 0) tx.insert(schema.allowedUsers).values(values).onConflictDoNothing().run();
    tx.insert(schema.appMeta).values({ key: ALLOW_LIST_SEEDED_KEY, value: now }).onConflictDoNothing().run();
  });
  return values.length;
}

// Last sign-in is the newest session a user's address ever opened; an invited address that never
// signed in has none. Aliases keep the two `created_at` columns apart.
type AllowedUserSqlRow = {
  email: string;
  role: AllowedRole;
  added_by: string;
  added_at: string;
  last_sign_in_ms: number | null;
  name: string | null;
};

export function listAllowedUsers(db: Db): AllowedUserRow[] {
  const rows = db.all<AllowedUserSqlRow>(sql`
    SELECT a.email, a.role, a.added_by, a.added_at,
      (SELECT u.name FROM user u WHERE lower(u.email) = a.email LIMIT 1) AS name,
      (SELECT max(s.created_at) FROM session s JOIN user u ON u.id = s.user_id WHERE lower(u.email) = a.email)
        AS last_sign_in_ms
    FROM allowed_users a
    ORDER BY a.added_at ASC, a.email ASC
  `);
  return rows.map((row) => ({
    email: row.email,
    role: row.role,
    addedBy: row.added_by,
    addedAt: row.added_at,
    lastSignInAt: row.last_sign_in_ms === null ? null : new Date(row.last_sign_in_ms).toISOString(),
    name: row.name,
  }));
}

export function addAllowedUser(
  db: Db,
  input: { email: string; role: AllowedRole; addedBy: string; now?: string },
): AllowedUserRow | null {
  const email = normalizeEmail(input.email);
  const existing = roleForEmail(db, email);
  if (existing !== null) return null;
  db.insert(schema.allowedUsers)
    .values({ email, role: input.role, addedBy: input.addedBy, addedAt: input.now ?? new Date().toISOString() })
    .onConflictDoNothing()
    .run();
  return listAllowedUsers(db).find((row) => row.email === email) ?? null;
}

export function setAllowedRole(db: Db, email: string, role: AllowedRole, actorId = 'system'): boolean {
  const address = normalizeEmail(email);
  if (roleForEmail(db, address) === null) return false;
  db.transaction((tx) => {
    const result = tx
      .update(schema.allowedUsers)
      .set({ role })
      .where(and(eq(schema.allowedUsers.email, address), ne(schema.allowedUsers.role, role)))
      .run();
    if (!result.changes) return;
    if (role === 'player') {
      const edits = tx
        .select({ gameId: schema.gameAccess.gameId })
        .from(schema.gameAccess)
        .where(and(eq(schema.gameAccess.email, address), eq(schema.gameAccess.access, 'edit')))
        .all();
      const now = new Date().toISOString();
      for (const { gameId } of edits) {
        tx.update(schema.gameAccess)
          .set({ access: 'play', updatedBy: actorId, updatedAt: now })
          .where(and(eq(schema.gameAccess.email, address), eq(schema.gameAccess.gameId, gameId)))
          .run();
        tx.insert(schema.gameAccessAudit)
          .values({
            id: randomUUID(),
            gameId,
            email: address,
            previousAccess: 'edit',
            access: 'play',
            actorId,
            createdAt: now,
          })
          .run();
      }
    }
    for (const user of tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(sql`lower(${schema.user.email}) = ${address}`)
      .all())
      invalidateArtifactGrants(tx, 'user', user.id);
  });
  return true;
}

// Removing an address also deletes that user's sessions, so an open browser cannot keep playing on
// a cookie issued before the removal.
export function removeAllowedUser(db: Db, email: string): boolean {
  const address = normalizeEmail(email);
  return db.transaction((tx) => {
    const deleted = tx.delete(schema.allowedUsers).where(eq(schema.allowedUsers.email, address)).run();
    if (deleted.changes === 0) return false;
    tx.update(schema.invitations)
      .set({ revokedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.invitations.email, address),
          eq(schema.invitations.kind, 'member'),
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
        ),
      )
      .run();
    const users = tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(sql`lower(${schema.user.email}) = ${address}`)
      .all();
    if (users.length > 0) {
      tx.delete(schema.session)
        .where(
          inArray(
            schema.session.userId,
            users.map((user) => user.id),
          ),
        )
        .run();
    }
    return true;
  });
}
