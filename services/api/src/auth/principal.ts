import type { Principal } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

import type { Resolver } from '../app/registry.js';
import type { Auth } from './auth.js';

type Membership = { family_id: string; role: string; capability: string };
const FALLBACK_DISPLAY_NAME = 'Player';

// OGM-012 owns `family_members`; until its migration lands every user is a familyless player.
function membership(sqlite: Sqlite, userId: string): Membership | undefined {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'family_members'").get();
  if (!table) return undefined;
  return sqlite
    .prepare<[string], Membership>('SELECT family_id, role, capability FROM family_members WHERE user_id = ? LIMIT 1')
    .get(userId);
}

export function sessionDisplayName(name: string, email: string): string {
  const trimmed = name.trim().slice(0, 40);
  return trimmed && trimmed.toLowerCase() !== email.trim().toLowerCase() ? trimmed : FALLBACK_DISPLAY_NAME;
}

export type RoleLookup = (email: string) => 'player' | 'maker' | 'admin' | null;

// A session cookie or `Authorization: Bearer <session token>` (bearer plugin) becomes a `user`. The
// allow list decides whether the address may sign in at all and which role it holds; the family
// still supplies the games it can see. `maintainers` is the operator's break-glass set from
// `OGM_MAINTAINER_EMAILS`, kept as its own audited platform role.
export function sessionResolver(
  auth: Auth,
  sqlite: Sqlite,
  roleFor: RoleLookup,
  maintainers: ReadonlySet<string> = new Set(),
): Resolver {
  return async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return null;
    const email = session.user.email.trim().toLowerCase();
    const role = roleFor(email);
    if (role === null) return null;

    const member = membership(sqlite, session.user.id);
    const platformRole: Extract<Principal, { kind: 'user' }>['platformRole'] = maintainers.has(email)
      ? 'maintainer'
      : role === 'admin'
        ? 'admin'
        : 'none';
    return {
      kind: 'user',
      userId: session.user.id,
      displayName: sessionDisplayName(session.user.name, session.user.email),
      familyId: member?.family_id ?? '',
      platformRole,
      capability: role === 'player' || member?.capability === 'player' ? 'player' : 'creator',
    };
  };
}
