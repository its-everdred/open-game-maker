import type { VoiceTarget } from '@ogm/contracts';
import { loadEnv } from '@ogm/config';
import { schema, type Db } from '@ogm/db';
import { authorize, type Actor } from '@ogm/policy';
import { eq } from 'drizzle-orm';

import { roleForEmail } from '../auth/allow-list.js';
import { normalizeEmail, parseEmailList } from '../auth/access.js';
import { getGameAccess } from '../games/games.js';
import { gameDrafts } from '../new-game/drafts.js';

// The host can keep a token open after the user's role or game access changes. Resolve both anew
// for every callback and briefing; the creator id in the target is an identity, not authority.
export function voiceActor(db: Db, target: VoiceTarget): Actor | null {
  const user = db.select().from(schema.user).where(eq(schema.user.id, target.creator_id)).get();
  if (!user) return null;
  const role = roleForEmail(db, user.email);
  if (!role || role === 'player') return null;
  const member = db.select().from(schema.familyMembers).where(eq(schema.familyMembers.userId, user.id)).get();
  const env = loadEnv('api', { OGM_MAINTAINER_EMAILS: { kind: 'string', required: false } });
  const platformRole = parseEmailList(env.OGM_MAINTAINER_EMAILS).has(normalizeEmail(user.email))
    ? 'maintainer'
    : role === 'admin'
      ? 'admin'
      : 'none';
  const actor: Actor = {
    userId: user.id,
    familyId: member?.familyId ?? '',
    capability: 'creator',
    platformRole,
  };
  if (target.kind === 'scope') {
    const draft = gameDrafts.get(db, target.session_id);
    if (draft?.id === target.game_id) {
      return ['open', 'agreed'].includes(draft.status) &&
        authorize(actor, 'game.edit', { familyId: draft.familyId, ownerId: draft.creatorId }).ok
        ? actor
        : null;
    }
  }
  const game = db.select().from(schema.games).where(eq(schema.games.id, target.game_id)).get();
  if (!game || (game.familyId !== actor.familyId && game.delistedAt !== null)) return null;
  return authorize(actor, 'game.edit', {
    familyId: game.familyId,
    ownerId: game.ownerId,
    gameAccess: getGameAccess(db, game.id, user.id),
  }).ok
    ? actor
    : null;
}
