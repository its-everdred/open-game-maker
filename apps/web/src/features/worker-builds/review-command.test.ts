import { expect, it } from 'vitest';
import { readOnlyGameIds, withoutGameCommands } from './review-command';

it('keeps one game-scoped copy of a decision from a shared daemon', () => {
  const core = [{ decision_id: 'shared' }, { decision_id: 'core-only' }];
  expect(withoutGameCommands(core, [{ decision_id: 'shared' }])).toEqual([{ decision_id: 'core-only' }]);
});

it('makes every game read-only when an administrator has player capability', () => {
  const games = [
    { id: 'mine', ownerId: 'admin' },
    { id: 'other', ownerId: 'someone' },
  ];
  expect(readOnlyGameIds(games, 'admin', 'creator')).toEqual(['other']);
  expect(readOnlyGameIds(games, 'admin', 'player')).toEqual(['mine', 'other']);
});
