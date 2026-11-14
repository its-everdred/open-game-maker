import { expect, it } from 'vitest';
import { nextPhaseMarker, nextPhaseTicket } from '../../src/review-rounds/next-phase.js';
import type { ReviewRound } from '../../src/review-rounds/store.js';

const round: ReviewRound = {
  id: 'round-1',
  gameId: 'game',
  track: 'art',
  phase: 'concept',
  category: 'art',
  round: 1,
  ticket: '42',
  prNumber: 7,
  sha: 'a'.repeat(40),
  media: JSON.stringify([
    { kind: 'still', ref: `sha256:${'a'.repeat(64)}` },
    { kind: 'audio', ref: 'private-ref' },
  ]),
  question: null,
  postedAt: '2026-01-01T00:00:00Z',
  verdict: 'approved',
  notes: null,
  verdictAt: '2026-01-01T01:00:00Z',
  verdictSource: 'preview',
  consumedByRun: null,
  consumedAt: null,
  remindedAt: null,
};

it('creates a stable phase marker and names the approved concept in the conversion ticket', () => {
  const ticket = nextPhaseTicket(round);
  expect(ticket.title).toContain('asset pack');
  expect(ticket.body).toContain('Approved review round: round-1');
  expect(ticket.body).toContain(`sha256:${'a'.repeat(64)}`);
  expect(ticket.body).not.toContain('private-ref');
  expect(ticket.body).toContain(nextPhaseMarker(round));
  expect(nextPhaseMarker({ ...round, id: 'round-2' } as ReviewRound)).toBe(nextPhaseMarker(round));
  expect(() => nextPhaseTicket({ ...round, verdict: 'needs_work' })).toThrow('review_round_not_approved');
});

it('requires the follow-up gameplay review to contain a build and design question', () => {
  const ticket = nextPhaseTicket({ ...round, category: 'gameplay' });
  expect(ticket.body).toContain('gm preview build');
  expect(ticket.body).toContain('design question');
});
