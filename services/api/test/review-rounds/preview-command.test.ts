import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import previewRoutes from '../../src/previews/routes.js';
import { createPreview, submitReviewRound } from '../../src/previews/store.js';
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

it('keeps an unanswered gameplay preview answerable until its verdict', async () => {
  const { deps } = world();
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
  await expect(createPreview(deps, ids.game, '12', SHA, archive)).rejects.toThrow('review_round_open');
  answerRound(deps.db, ids.game, 'round', {
    verdict: 'needs_work',
    notes: 'again',
    source: 'command',
    at: '2026-01-01T01:00:00Z',
  });
  await expect(createPreview(deps, ids.game, '12', SHA, archive)).resolves.toMatchObject({ ticket: '12' });
});

it('serializes posting a round with replacement of its preview', async () => {
  const { deps } = world();
  const archive = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', builtFiles(), '.']);
  const preview = await createPreview(deps, ids.game, '12', SHA, archive);
  const submission = {
    id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
    track: 'game',
    phase: 'concept',
    category: 'gameplay' as const,
    ticket: '12',
    sha: SHA,
    question: 'Play?',
    media: [{ kind: 'build' as const, ref: preview.buildId }],
  };
  const results = await Promise.allSettled([
    submitReviewRound(deps, ids.game, submission),
    createPreview(deps, ids.game, '12', SHA, archive),
  ]);
  expect(results[0]?.status).toBe('fulfilled');
  expect(results[1]).toMatchObject({
    status: 'rejected',
    reason: expect.objectContaining({ message: 'review_round_open' }),
  });
});

it('refuses to post a round for a preview replaced first', async () => {
  const { deps } = world();
  const archive = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', builtFiles(), '.']);
  const preview = await createPreview(deps, ids.game, '12', SHA, archive);
  const submission = {
    id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
    track: 'game',
    phase: 'concept',
    category: 'gameplay' as const,
    ticket: '12',
    sha: SHA,
    question: 'Play?',
    media: [{ kind: 'build' as const, ref: preview.buildId }],
  };
  const results = await Promise.allSettled([
    createPreview(deps, ids.game, '12', SHA, archive),
    submitReviewRound(deps, ids.game, submission),
  ]);
  expect(results[0]?.status).toBe('fulfilled');
  expect(results[1]).toMatchObject({
    status: 'rejected',
    reason: expect.objectContaining({ message: 'preview_not_found' }),
  });
});

it('accepts an identical retry after its answered preview is replaced', async () => {
  const { deps } = world();
  const archive = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', builtFiles(), '.']);
  const preview = await createPreview(deps, ids.game, '12', SHA, archive);
  const submission = {
    id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
    track: 'game',
    phase: 'concept',
    category: 'gameplay' as const,
    ticket: '12',
    sha: SHA,
    question: 'Play?',
    media: [{ kind: 'build' as const, ref: preview.buildId }],
  };
  const round = await submitReviewRound(deps, ids.game, submission);
  answerRound(deps.db, ids.game, round.id, {
    verdict: 'needs_work',
    notes: 'again',
    source: 'command',
    at: '2026-01-01T01:00:00Z',
  });
  await createPreview(deps, ids.game, '12', SHA, archive);
  expect(await submitReviewRound(deps, ids.game, submission)).toMatchObject({ id: round.id, round: 1 });
});
