import { expect, it, vi } from 'vitest';
import { advanceApproval } from '../../src/review-rounds/approval.js';
import { phaseOwner } from '../../src/review-rounds/owners.js';
import { answerRound, getRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it('advances mock to build on the same ticket and closes only after the final approval', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const track = {
    id: 'art',
    category: 'art' as const,
    phases: [
      { id: 'mock', ticket: '42', template: 'mock' },
      { id: 'build', template: 'Build the approved image' },
    ],
  };
  const sha = 'a'.repeat(40);
  postRound(deps.db, {
    id: 'first',
    gameId: GAME,
    track: 'art',
    phase: 'mock',
    effort: 'low',
    category: 'art',
    round: 1,
    ticket: '42',
    sha,
    media: '[{"kind":"still","ref":"sha256:abc"}]',
    postedAt: '2026-01-01',
  });
  answerRound(deps.db, GAME, 'first', { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  const issues = { setFidelity: vi.fn(), close: vi.fn() };
  let reason = '';
  const delivery = {
    rework: vi.fn(async (_ticket: string, body: string) => {
      reason = body;
    }),
    findMarker: vi.fn(async () => ({ runId: 'run-1' })),
  };
  const input = {
    db: deps.db,
    round: getRound(deps.db, GAME, 'first')!,
    track,
    repo: 'owner/repo',
    issues,
    delivery,
    now: () => '2026-01-03',
  };
  await advanceApproval(input);
  await advanceApproval(input);
  expect(issues.setFidelity).toHaveBeenCalledOnce();
  expect(issues.setFidelity).toHaveBeenCalledWith('owner/repo', '42', 'build', 'xhigh');
  expect(delivery.rework).toHaveBeenCalledOnce();
  expect(reason).toContain('Build the approved image');
  expect(reason).toContain(sha);
  expect(reason).toContain('sha256:abc');
  expect(phaseOwner(deps.db, GAME, track, 'build')).toBe('42');
  expect(issues.close).not.toHaveBeenCalled();
  postRound(deps.db, {
    id: 'last',
    gameId: GAME,
    track: 'art',
    phase: 'build',
    effort: 'xhigh',
    category: 'art',
    round: 1,
    ticket: '42',
    sha,
    media: '[]',
    postedAt: '2026-01-04',
  });
  answerRound(deps.db, GAME, 'last', { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-05' });
  await advanceApproval({ ...input, round: getRound(deps.db, GAME, 'last')! });
  expect(issues.close).toHaveBeenCalledWith('owner/repo', '42');
});

it('does not close a ticket with another owned unapproved phase', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const track = { id: 'art', category: 'art' as const, phases: [{ id: 'mock', ticket: '42', template: 'mock' }] };
  phaseOwner(
    deps.db,
    GAME,
    { id: 'sound', category: 'sound', phases: [{ id: 'mock', ticket: '42', template: 'mock' }] },
    'mock',
  );
  postRound(deps.db, {
    id: 'first',
    gameId: GAME,
    track: 'art',
    phase: 'mock',
    category: 'art',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-01-01',
  });
  answerRound(deps.db, GAME, 'first', { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  const issues = { setFidelity: vi.fn(), close: vi.fn() };
  await advanceApproval({
    db: deps.db,
    round: getRound(deps.db, GAME, 'first')!,
    track,
    repo: 'owner/repo',
    issues,
    delivery: { rework: vi.fn(), findMarker: vi.fn() },
    now: () => '2026-01-03',
  });
  expect(issues.close).not.toHaveBeenCalled();
});

it('keeps legacy track phase IDs while assigning their next fidelity rung', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const track = {
    id: 'art',
    category: 'art' as const,
    phases: [
      { id: 'concept', ticket: '42', template: 'concept' },
      { id: 'refined', template: 'refine' },
    ],
  };
  postRound(deps.db, {
    id: 'first',
    gameId: GAME,
    track: 'art',
    phase: 'concept',
    category: 'art',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-01-01',
  });
  answerRound(deps.db, GAME, 'first', { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  const issues = { setFidelity: vi.fn(), close: vi.fn() };
  const delivery = { rework: vi.fn(), findMarker: vi.fn().mockResolvedValue({ runId: 'run-1' }) };
  await advanceApproval({
    db: deps.db,
    round: getRound(deps.db, GAME, 'first')!,
    track,
    repo: 'owner/repo',
    issues,
    delivery,
    now: () => '2026-01-03',
  });
  expect(issues.setFidelity).toHaveBeenCalledWith('owner/repo', '42', 'prototype', 'medium');
  expect(phaseOwner(deps.db, GAME, track, 'refined')).toBe('42');
});
