import { expect, it, vi } from 'vitest';
import { advanceApproval } from '../../src/review-rounds/approval.js';
import { phaseOwner } from '../../src/review-rounds/owners.js';
import { answerRound, getRound, postRound } from '../../src/review-rounds/store.js';
import { GAME, seedDesignGame } from '../design-decisions/fixtures.js';
import { makeDeps } from '../helpers.js';

it.each(['art', 'gameplay'] as const)(
  'creates one %s follow-up, assigns its phase and survives an indeterminate response',
  async (category) => {
    const deps = makeDeps();
    seedDesignGame(deps);
    postRound(deps.db, {
      id: 'round-1',
      gameId: GAME,
      track: category,
      phase: 'concept',
      category,
      round: 1,
      ticket: '42',
      sha: 'a'.repeat(40),
      media: '[]',
      postedAt: '2026-01-01T00:00:00Z',
    });
    answerRound(deps.db, GAME, 'round-1', {
      verdict: 'approved',
      notes: null,
      source: 'preview',
      at: '2026-01-01T01:00:00Z',
    });
    const round = getRound(deps.db, GAME, 'round-1')!;
    const track = {
      id: category,
      category,
      phases: [
        { id: 'concept', ticket: '42', template: 'concept' },
        { id: 'build', template: 'build' },
      ],
    };
    let created = 0;
    let ticket: string | null = null;
    const ensureFollowup = vi.fn(
      async (_repo: string, _slug: string, marker: string, issue: { title: string; body: string }) => {
        expect(issue.body).toContain('Approved review round: round-1');
        expect(issue.body).toContain(marker);
        if (category === 'gameplay') expect(issue.body).toContain('gm preview build');
        else expect(issue.title).toContain('asset pack');
        if (!ticket) {
          ticket = '77';
          created += 1;
          throw new Error('response lost');
        }
        return ticket;
      },
    );
    const close = vi.fn(async () => {});
    const nudgeTodo = vi.fn(async () => {});
    const input = {
      db: deps.db,
      round,
      track,
      repo: 'owner/repo',
      slug: 'game',
      issues: { ensureFollowup, close, merged: vi.fn().mockResolvedValue(true) },
      client: { nudgeTodo },
      now: () => '2026-01-01T02:00:00Z',
    };
    await expect(advanceApproval(input)).rejects.toThrow('response lost');
    await advanceApproval(input);
    await advanceApproval(input);
    expect(created).toBe(1);
    expect(nudgeTodo).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(phaseOwner(deps.db, GAME, track, 'build')).toBe('77');
  },
);

it('seeds the initial owner once and does not preassign later phases', () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const track = {
    id: 'art',
    category: 'art' as const,
    phases: [
      { id: 'concept', ticket: '42', template: 'concept' },
      { id: 'build', ticket: '99', template: 'build' },
    ],
  };
  expect(phaseOwner(deps.db, GAME, track, 'concept')).toBe('42');
  expect(phaseOwner(deps.db, GAME, { ...track, phases: [{ ...track.phases[0]!, ticket: '43' }] }, 'concept')).toBe(
    '42',
  );
  expect(phaseOwner(deps.db, GAME, track, 'build')).toBeNull();
});

it('keeps an owner open while another assigned phase is unapproved', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  const first = {
    id: 'first',
    gameId: GAME,
    track: 'art',
    phase: 'concept',
    category: 'art' as const,
    round: 1,
    ticket: '42',
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-01-01T00:00:00Z',
  };
  postRound(deps.db, first);
  answerRound(deps.db, GAME, first.id, {
    verdict: 'approved',
    notes: null,
    source: 'preview',
    at: '2026-01-01T01:00:00Z',
  });
  const track = { id: 'art', category: 'art' as const, phases: [{ id: 'concept', ticket: '42', template: 'concept' }] };
  const other = { id: 'sound', category: 'sound' as const, phases: [{ id: 'cue', ticket: '42', template: 'cue' }] };
  phaseOwner(deps.db, GAME, other, 'cue');
  const close = vi.fn();
  await advanceApproval({
    db: deps.db,
    round: getRound(deps.db, GAME, 'first')!,
    track,
    repo: 'owner/repo',
    slug: 'game',
    issues: { ensureFollowup: vi.fn(), close, merged: vi.fn().mockResolvedValue(true) },
    client: { nudgeTodo: vi.fn() },
    now: () => '2026-01-01T02:00:00Z',
  });
  expect(close).not.toHaveBeenCalled();
});

it('files the follow-up immediately and queues it after the approved PR merges', async () => {
  const deps = makeDeps();
  seedDesignGame(deps);
  postRound(deps.db, {
    id: 'r',
    gameId: GAME,
    track: 'art',
    phase: 'concept',
    category: 'art',
    round: 1,
    ticket: '42',
    prNumber: 8,
    sha: 'a'.repeat(40),
    media: '[]',
    postedAt: '2026-01-01T00:00:00Z',
  });
  answerRound(deps.db, GAME, 'r', { verdict: 'approved', notes: null, source: 'preview', at: '2026-01-01T01:00:00Z' });
  const track = {
    id: 'art',
    category: 'art' as const,
    phases: [
      { id: 'concept', ticket: '42', template: 'concept' },
      { id: 'build', template: 'build' },
    ],
  };
  const issues = {
    ensureFollowup: vi.fn().mockResolvedValue('77'),
    close: vi.fn(),
    merged: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
  };
  const client = { nudgeTodo: vi.fn() };
  const input = {
    db: deps.db,
    round: getRound(deps.db, GAME, 'r')!,
    track,
    repo: 'owner/repo',
    slug: 'game',
    issues,
    client,
    now: () => 'now',
  };
  await advanceApproval(input);
  expect(issues.ensureFollowup).toHaveBeenCalledOnce();
  expect(client.nudgeTodo).not.toHaveBeenCalled();
  expect(phaseOwner(deps.db, GAME, track, 'build')).toBe('77');
  await advanceApproval(input);
  expect(issues.ensureFollowup).toHaveBeenCalledOnce();
  expect(client.nudgeTodo).toHaveBeenCalledWith(['77']);
});
