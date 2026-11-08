import { describe, expect, it } from 'vitest';

import { ACTIONS, authorize, type Action, type Actor, type Resource } from '../src/index.js';

const actors = {
  maintainer: {
    userId: 'maintainer',
    familyId: 'family-a',
    platformRole: 'maintainer',
    capability: 'creator',
  },
  admin: { userId: 'admin', familyId: 'family-a', platformRole: 'admin', capability: 'creator' },
  creator: { userId: 'creator', familyId: 'family-a', platformRole: 'none', capability: 'creator' },
  player: { userId: 'player', familyId: 'family-a', platformRole: 'none', capability: 'player' },
} as const satisfies Record<string, Actor>;

type ActorName = keyof typeof actors;
type Scope = 'own' | 'other' | 'other-family';

const own = [
  'game.create',
  'game.edit',
  'game.publish',
  'game.play',
  'game.fork',
  'job.create',
  'job.cancel',
  'job.edit',
  'member.invite',
  'game.delist',
  'report.file',
] as const satisfies readonly Action[];

const admin = [
  ...own,
  'admin.budget.set',
  'admin.members.manage',
  'admin.settings.set',
  'admin.analytics.read',
  'game.flag_abuse',
  'report.view',
  'admin.gameplay.set',
] as const satisfies readonly Action[];

const sameFamilyOther = {
  maintainer: ACTIONS,
  admin: [
    'game.create',
    'game.play',
    'game.fork',
    'member.invite',
    'admin.budget.set',
    'admin.members.manage',
    'admin.settings.set',
    'admin.analytics.read',
    'game.delist',
    'game.flag_abuse',
    'report.file',
    'report.view',
    'admin.gameplay.set',
  ],
  creator: ['game.create', 'game.play', 'game.fork', 'member.invite', 'report.file'],
  player: ['game.play', 'report.file'],
} as const satisfies Record<ActorName, readonly Action[]>;

const ownAllowed = {
  maintainer: ACTIONS,
  admin,
  creator: own,
  player: [
    'game.edit',
    'game.publish',
    'game.play',
    'game.fork',
    'job.cancel',
    'job.edit',
    'game.delist',
    'report.file',
  ],
} as const satisfies Record<ActorName, readonly Action[]>;

function resource(actor: Actor, action: Action, scope: Scope): Resource {
  const ownResource = scope === 'own';
  return {
    familyId: scope === 'other-family' ? 'family-b' : actor.familyId,
    ownerId: ownResource ? actor.userId : 'another-user',
    visibility: 'listed',
    inviteKind: 'play',
    audit: actor.platformRole === 'maintainer' && scope === 'other',
  };
}

const rows = Object.entries(actors).flatMap(([name, actor]) =>
  (['own', 'other', 'other-family'] as const).flatMap((scope) =>
    ACTIONS.map((action) => ({
      name: name as ActorName,
      actor,
      scope,
      action,
      ok:
        scope !== 'other-family' &&
        (scope === 'own' ? ownAllowed[name as ActorName] : sameFamilyOther[name as ActorName]).includes(
          action as never,
        ),
    })),
  ),
);

describe(`authorization matrix (${rows.length} rows)`, () => {
  it('exposes abuse flags as an admin-only family action', () => {
    const action: Action = 'game.flag_abuse';
    expect(ACTIONS).toContain(action);
    expect(authorize(actors.maintainer, action, resource(actors.maintainer, action, 'other')).ok).toBe(true);
    expect(authorize(actors.admin, action, resource(actors.admin, action, 'other')).ok).toBe(true);
    expect(authorize(actors.creator, action, resource(actors.creator, action, 'own')).ok).toBe(false);
    expect(authorize(actors.admin, action, resource(actors.admin, action, 'other-family')).ok).toBe(false);
  });

  it('treats job edits as owner-only controls', () => {
    expect(authorize(actors.creator, 'job.edit' as Action, resource(actors.creator, 'job.cancel', 'own')).ok).toBe(
      true,
    );
    expect(authorize(actors.creator, 'job.edit' as Action, resource(actors.creator, 'job.cancel', 'other')).ok).toBe(
      false,
    );
  });

  for (const row of rows) {
    it(`${row.name} ${row.action} on ${row.scope}`, () => {
      expect(authorize(row.actor, row.action, resource(row.actor, row.action, row.scope)).ok).toBe(row.ok);
    });
  }
});
