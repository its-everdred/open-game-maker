import { schema } from '@ogm/db';
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
  const issues = {
    setFidelity: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    legacyStarted: vi.fn().mockResolvedValue(false),
    integrated: vi.fn().mockResolvedValue(true),
  };
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
    enqueueLegacy: vi.fn(),
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
  const issues = {
    setFidelity: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    legacyStarted: vi.fn().mockResolvedValue(false),
    integrated: vi.fn().mockResolvedValue(true),
  };
  await advanceApproval({
    db: deps.db,
    round: getRound(deps.db, GAME, 'first')!,
    track,
    repo: 'owner/repo',
    issues,
    delivery: { rework: vi.fn(), findMarker: vi.fn() },
    enqueueLegacy: vi.fn(),
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
  const issues = {
    setFidelity: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    legacyStarted: vi.fn().mockResolvedValue(false),
    integrated: vi.fn().mockResolvedValue(true),
  };
  const delivery = { rework: vi.fn(), findMarker: vi.fn().mockResolvedValue({ runId: 'run-1' }) };
  await advanceApproval({
    db: deps.db,
    round: getRound(deps.db, GAME, 'first')!,
    track,
    repo: 'owner/repo',
    issues,
    delivery,
    enqueueLegacy: vi.fn(),
    now: () => '2026-01-03',
  });
  expect(issues.setFidelity).toHaveBeenCalledWith('owner/repo', '42', 'prototype', 'medium');
  expect(phaseOwner(deps.db, GAME, track, 'refined')).toBe('42');
});

it('serializes competing transitions on a shared ticket', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const art = {
    id: 'art',
    category: 'art' as const,
    phases: [
      { id: 'mock', ticket: '42', template: 'mock' },
      { id: 'build', template: 'build' },
    ],
  };
  const sound = {
    id: 'sound',
    category: 'sound' as const,
    phases: [
      { id: 'mock', ticket: '42', template: 'mock' },
      { id: 'prototype', template: 'prototype' },
    ],
  };
  const add = (id: string, track: 'art' | 'sound', phase: string) => {
    postRound(deps.db, {
      id,
      gameId: GAME,
      track,
      phase,
      category: track,
      round: 1,
      ticket: '42',
      sha: 'a'.repeat(40),
      media: '[]',
      postedAt: '2026-01-01',
    });
    answerRound(deps.db, GAME, id, { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  };
  add('a', 'art', 'mock');
  add('s', 'sound', 'mock');
  const issues = {
    setFidelity: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    legacyStarted: vi.fn().mockResolvedValue(false),
    integrated: vi.fn().mockResolvedValue(true),
  };
  const delivery = { rework: vi.fn(), findMarker: vi.fn().mockResolvedValue({ runId: 'run-1' }) };
  const input = { db: deps.db, repo: 'owner/repo', issues, delivery, enqueueLegacy: vi.fn(), now: () => '2026-01-03' };
  await advanceApproval({ ...input, round: getRound(deps.db, GAME, 'a')!, track: art });
  await advanceApproval({ ...input, round: getRound(deps.db, GAME, 's')!, track: sound });
  expect(issues.setFidelity).toHaveBeenCalledTimes(1);
  add('b', 'art', 'build');
  await advanceApproval({ ...input, round: getRound(deps.db, GAME, 's')!, track: sound });
  expect(issues.setFidelity).toHaveBeenLastCalledWith('owner/repo', '42', 'prototype', 'medium');
});

it.each(['pending', 'queued', 'ambiguous'])('reconciles a legacy follow-up (%s)', async (state) => {
  const queued = state === 'queued';
  const deps = makeDeps();
  seedDesignGame(deps);
  const track = {
    id: 'art',
    category: 'art' as const,
    phases: [
      { id: 'concept', ticket: '42', template: 'art' },
      { id: 'build', template: 'build' },
    ],
  };
  postRound(deps.db, {
    id: 'r',
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
  answerRound(deps.db, GAME, 'r', { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  phaseOwner(deps.db, GAME, track, 'concept');
  deps.db
    .insert(schema.reviewPhaseOwners)
    .values({ gameId: GAME, track: 'art', phase: 'build', ticket: '77', sourceRoundId: 'r' })
    .run();
  deps.db
    .insert(schema.reviewDispatchIntents)
    .values({ roundId: 'r', ticket: '42', state: 'dispatching', createdAt: '2026-01-02', runId: queued ? '77' : null })
    .run();
  const issues = {
    setFidelity: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    legacyStarted: vi.fn().mockResolvedValue(false),
    integrated: vi.fn().mockResolvedValue(true),
  };
  if (state === 'ambiguous') issues.legacyStarted.mockResolvedValue(true);
  const enqueueLegacy = vi.fn();
  const delivery = { rework: vi.fn(), findMarker: vi.fn().mockResolvedValue({ runId: 'run-1' }) };
  await advanceApproval({
    db: deps.db,
    round: getRound(deps.db, GAME, 'r')!,
    track,
    repo: 'owner/repo',
    issues,
    delivery,
    enqueueLegacy,
    now: () => '2026-01-03',
  });
  expect(enqueueLegacy).toHaveBeenCalledTimes(state === 'pending' ? 1 : 0);
  expect(issues.cancel).not.toHaveBeenCalled();
  expect(delivery.rework).not.toHaveBeenCalled();
  expect(phaseOwner(deps.db, GAME, track, 'build')).toBe('77');
});

it('defers a rejected track while another track has an unfinished phase', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 's',
    gameId: GAME,
    track: 'sound',
    phase: 'mock',
    category: 'sound',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-01-01',
  });
  answerRound(deps.db, GAME, 's', { verdict: 'needs_work', notes: 'fix', source: 'preview', at: '2026-01-02' });
  postRound(deps.db, {
    id: 'a',
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
  answerRound(deps.db, GAME, 'a', { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  deps.db
    .insert(schema.reviewPhaseOwners)
    .values({ gameId: GAME, track: 'art', phase: 'build', ticket: '42', sourceRoundId: 'a' })
    .run();
  const { otherPhaseInProgress } = await import('../../src/review-rounds/owners.js');
  expect(otherPhaseInProgress(deps.db, getRound(deps.db, GAME, 's')!)).toBe(true);
});

it('waits for an initial-phase rework on another shared track', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const base = {
    gameId: GAME,
    phase: 'mock',
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-01-01',
  };
  postRound(deps.db, { ...base, id: 'a', track: 'art', category: 'art' });
  postRound(deps.db, { ...base, id: 's', track: 'sound', category: 'sound' });
  answerRound(deps.db, GAME, 'a', { verdict: 'needs_work', notes: 'fix', source: 'preview', at: '2026-01-02' });
  answerRound(deps.db, GAME, 's', { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  deps.db
    .insert(schema.reviewDispatchIntents)
    .values({ roundId: 'a', ticket: '42', state: 'consumed', createdAt: '2026-01-02' })
    .run();
  const { otherPhaseInProgress } = await import('../../src/review-rounds/owners.js');
  expect(otherPhaseInProgress(deps.db, getRound(deps.db, GAME, 's')!)).toBe(true);
});

it('keeps an already queued legacy successor from closing over another pending approval', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const track = {
    id: 'art',
    category: 'art' as const,
    phases: [
      { id: 'concept', ticket: '42', template: 'art' },
      { id: 'build', template: 'build' },
    ],
  };
  for (const [id, category] of [
    ['a', 'art'],
    ['s', 'sound'],
  ] as const) {
    postRound(deps.db, {
      id,
      gameId: GAME,
      track: category,
      phase: 'concept',
      category,
      round: 1,
      ticket: '42',
      sha: 'a'.repeat(40),
      media: '[]',
      postedAt: '2026-01-01',
    });
    answerRound(deps.db, GAME, id, { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-02' });
  }
  phaseOwner(deps.db, GAME, track, 'concept');
  phaseOwner(
    deps.db,
    GAME,
    { id: 'sound', category: 'sound', phases: [{ id: 'concept', ticket: '42', template: 'sound' }] },
    'concept',
  );
  deps.db
    .insert(schema.reviewPhaseOwners)
    .values({ gameId: GAME, track: 'art', phase: 'build', ticket: '77', sourceRoundId: 'a' })
    .run();
  deps.db
    .insert(schema.reviewDispatchIntents)
    .values({ roundId: 'a', ticket: '42', state: 'dispatching', runId: '77', createdAt: '2026-01-02' })
    .run();
  const issues = {
    setFidelity: vi.fn(),
    close: vi.fn(),
    cancel: vi.fn(),
    legacyStarted: vi.fn().mockResolvedValue(false),
    integrated: vi.fn().mockResolvedValue(true),
  };
  const input = {
    db: deps.db,
    round: getRound(deps.db, GAME, 'a')!,
    track,
    repo: 'owner/repo',
    issues,
    delivery: { rework: vi.fn(), findMarker: vi.fn() },
    enqueueLegacy: vi.fn(),
    now: () => '2026-01-03',
  };
  await advanceApproval(input);
  expect(issues.close).not.toHaveBeenCalled();
  deps.db
    .insert(schema.reviewDispatchIntents)
    .values({ roundId: 's', ticket: '42', state: 'consumed', createdAt: '2026-01-02' })
    .run();
  await advanceApproval(input);
  expect(issues.close).toHaveBeenCalledWith('owner/repo', '42');
});
