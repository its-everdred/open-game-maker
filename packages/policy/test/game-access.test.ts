import { describe, expect, it } from 'vitest';

import { authorize, type Actor } from '../src/index.js';

const editor: Actor = { userId: 'editor', familyId: 'other-family', platformRole: 'none', capability: 'creator' };
const game = { familyId: 'family', ownerId: 'owner', visibility: 'private' as const };

describe('per-game access', () => {
  it('honors explicit grants for maintainers while enforcing their user type', () => {
    const maintainer: Actor = { ...editor, platformRole: 'maintainer' };
    const granted = { ...game, gameAccess: 'edit' as const };
    expect(authorize(maintainer, 'game.edit', granted)).toEqual({ ok: true });
    expect(authorize(maintainer, 'game.publish', granted)).toEqual({ ok: true });
    expect(authorize({ ...maintainer, capability: 'player' }, 'game.edit', granted).ok).toBe(false);
    expect(authorize({ ...maintainer, capability: 'player' }, 'game.create').ok).toBe(false);
    expect(
      authorize({ ...maintainer, capability: 'player' }, 'game.publish', { ...game, ownerId: maintainer.userId }).ok,
    ).toBe(false);
  });

  it('allows a creator with an edit grant to edit across families, but does not grant ownership', () => {
    const resource = { ...game, gameAccess: 'edit' as const };
    expect(authorize(editor, 'game.edit', resource)).toEqual({ ok: true });
    expect(authorize(editor, 'game.play', resource)).toEqual({ ok: true });
    expect(authorize(editor, 'game.publish', resource)).toEqual({ ok: true });
    expect(authorize(editor, 'game.delist', resource).ok).toBe(false);
  });

  it('does not allow a player or a play-only user to edit', () => {
    expect(authorize({ ...editor, capability: 'player' }, 'game.edit', { ...game, gameAccess: 'edit' }).ok).toBe(false);
    expect(authorize(editor, 'game.edit', { ...game, gameAccess: 'play' }).ok).toBe(false);
    expect(
      authorize({ ...editor, capability: 'player', familyId: 'family' }, 'game.edit', {
        ...game,
        ownerId: editor.userId,
      }).ok,
    ).toBe(false);
  });

  it('hides a listed game even if an older play grant exists', () => {
    expect(
      authorize({ ...editor, familyId: 'family' }, 'game.play', {
        ...game,
        visibility: 'listed',
        gameAccess: 'hide',
        granted: true,
      }),
    ).toEqual({ ok: false, reason: 'game_hidden' });
  });

  it('prevents a creator from forking a hidden game while preserving owner and ordinary access', () => {
    const actor = { ...editor, familyId: 'family' };
    const listed = { ...game, visibility: 'listed' as const };
    expect(authorize(actor, 'game.fork', { ...listed, gameAccess: 'hide' })).toEqual({
      ok: false,
      reason: 'game_hidden',
    });
    expect(authorize(actor, 'game.fork', listed)).toEqual({ ok: true });
    expect(authorize(actor, 'game.fork', { ...listed, ownerId: actor.userId, gameAccess: 'hide' })).toEqual({
      ok: true,
    });
  });
});
