import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import previewRoutes from '../../src/previews/routes.js';
import { createPreview } from '../../src/previews/store.js';
import { answerRound, postRound } from '../../src/review-rounds/store.js';
import { asUser } from '../helpers.js';
import { builtFiles, ids, SHA, world } from '../builds/fixtures.js';

it('removes a gameplay preview from the open queue after a Command verdict', async () => {
  const { deps, app } = world();
  app.route('/api/v1', previewRoutes);
  const archive = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', builtFiles(), '.']);
  const preview = await createPreview(deps, ids.game, '12', SHA, archive);
  postRound(deps.db, {
    id: 'round',
    gameId: ids.game,
    track: 'game',
    phase: 'concept',
    category: 'gameplay',
    round: 1,
    ticket: '12',
    sha: SHA,
    media: JSON.stringify([{ kind: 'build', ref: preview.buildId }]),
    postedAt: '2026-01-01T00:00:00Z',
  });
  const list = async () =>
    (await app.request(`/api/v1/games/${ids.game}/previews`, { headers: asUser(ids.user) })).json();
  expect(await list()).toMatchObject({ previews: [{ buildId: preview.buildId }] });
  answerRound(deps.db, ids.game, 'round', {
    verdict: 'needs_work',
    notes: 'again',
    source: 'command',
    at: '2026-01-01T01:00:00Z',
  });
  expect(await list()).toEqual({ previews: [] });
});
