import { describe, expect, it } from 'vitest';

import type { EnergyView, Job } from '@ogm/contracts/browser';

import type { WorkerBuild } from '../worker-builds/BuildTracker';
import type { ReviewCommand } from '../worker-builds/review-command';
import type { WorkerReview } from '../worker-builds/useWorkerReviews';
import { DONE_VISIBLE_MS, energyCards, reviewCards, workRows } from './model';

const NOW = Date.parse('2026-11-24T12:00:00Z');

function worker(ticket: string, extra: Partial<WorkerBuild> = {}): WorkerBuild {
  return { ticket: `g1:${ticket}`, title: `Ticket ${ticket}`, percent: null, etaSeconds: null, ...extra };
}

function job(id: string, extra: Partial<Job> = {}): Job {
  return {
    id,
    gameId: 'g1',
    state: 'running',
    aiurIssueNumber: null,
    updatedAt: '2026-11-24T11:59:00Z',
    plan: { title: `Job ${id}` },
    ...extra,
  } as Job;
}

describe('edit menu work rows (#1326)', () => {
  it('puts what waits on the creator first, then the furthest along', () => {
    const rows = workRows(
      'g1',
      [worker('22', { percent: 64 }), worker('41', { percent: 90 }), worker('969', { percent: 80 })],
      [],
      new Set(['969']),
      NOW,
    );
    expect(rows.map((row) => [row.ticket, row.state])).toEqual([
      ['969', 'wait'],
      ['41', 'work'],
      ['22', 'work'],
    ]);
  });

  it('leaves reviews to the Review section and other games to their own menus', () => {
    const rows = workRows(
      'g1',
      [worker('16', { state: 'human-review' }), { ...worker('5'), ticket: 'g2:5' }, worker('7')],
      [],
      new Set(),
      NOW,
    );
    expect(rows.map((row) => row.ticket)).toEqual(['7']);
  });

  it("opens the owning job's chat and shows its stage when aiur has no line", () => {
    const rows = workRows(
      'g1',
      [worker('41', { percent: 55 })],
      [job('j41', { aiurIssueNumber: 41, stageText: 'Placing trees', openRequestCount: 1 })],
      new Set(),
      NOW,
    );
    expect(rows).toEqual([
      expect.objectContaining({ ticket: '41', jobId: 'j41', last: 'Placing trees', state: 'wait', percent: 55 }),
    ]);
  });

  it("prefers aiur's own line over the job stage", () => {
    const [row] = workRows(
      'g1',
      [worker('41', { last: 'Rendering stills' })],
      [job('j41', { aiurIssueNumber: 41, stageText: 'Building' })],
      new Set(),
      NOW,
    );
    expect(row!.last).toBe('Rendering stills');
  });

  it('shows a job no worker lists yet, and a finished one only for a few minutes', () => {
    const fresh = new Date(NOW - 60_000).toISOString();
    const stale = new Date(NOW - DONE_VISIBLE_MS - 1).toISOString();
    const rows = workRows(
      'g1',
      [],
      [
        job('queued', { state: 'queued', progressPercent: 0 }),
        job('landed', { state: 'done', terminalAt: fresh }),
        job('old', { state: 'done', terminalAt: stale }),
        job('broke', { state: 'failed', terminalAt: fresh }),
        job('other', { gameId: 'g2' }),
      ],
      new Set(),
      NOW,
    );
    expect(rows.map((row) => [row.jobId, row.state, row.percent])).toEqual([
      ['queued', 'work', 0],
      ['landed', 'done', 100],
    ]);
  });
});

describe('edit menu review cards (#1326)', () => {
  it('names each review by its ticket, with a still when it has one and a play marker for slices', () => {
    const reviews: WorkerReview[] = [
      {
        kind: 'round',
        gameId: 'g1',
        round: {
          id: 'r1',
          ticket: '16',
          question: 'Orbs?',
          media: [{ kind: 'still', url: 'https://x/still.png' }],
        },
      },
      {
        kind: 'round',
        gameId: 'g1',
        round: { id: 'r2', ticket: '22', question: null, sliceUrl: 'https://x/slice', media: [] },
      },
    ];
    const cards = reviewCards(reviews, [], [], [worker('16', { title: 'UI kit' })]);
    expect(cards.map(({ title, sub, image }) => ({ title, sub, image }))).toEqual([
      { title: 'UI kit', sub: '#16', image: 'https://x/still.png' },
      { title: 'Build #22', sub: '#22 · play', image: undefined },
    ]);
  });

  it("shows a decision's first picture and option count", () => {
    const command = {
      game_id: 'g1',
      decision_id: 'd1',
      ticket: '969',
      title: 'Lighting',
      summary: 'Dusk and torch',
      options: [
        { id: 'a', label: 'Warm', media: { url: 'https://x/a.png', width: 1, height: 1 } },
        { id: 'b', label: 'Cool' },
      ],
    } as unknown as ReviewCommand;
    expect(reviewCards([], [command], [], [])).toEqual([
      expect.objectContaining({ title: 'Dusk and torch', sub: '#969 · 2 options', image: 'https://x/a.png' }),
    ]);
  });
});

describe('edit menu energy (#1326)', () => {
  const base: EnergyView = {
    level: 'healthy',
    preference: 'balanced',
    windows: [{ window: 'week', usedPercent: 40, resetsAt: '2026-11-27T09:00:00Z' }],
    services: [],
    sources: [],
  };

  it('shows provider readings when there are any, and a stale one as unknown', () => {
    const view: EnergyView = {
      ...base,
      sources: [
        {
          id: 'claude',
          label: 'Claude',
          usedPercent: 62,
          resetsAt: null,
          basis: 'reported',
          observedAt: null,
          stale: false,
        },
        {
          id: 'codex',
          label: 'Codex',
          usedPercent: 91,
          resetsAt: null,
          basis: 'reported',
          observedAt: null,
          stale: true,
        },
      ],
    };
    expect(energyCards(view).map(({ name, usedPercent }) => [name, usedPercent])).toEqual([
      ['Claude', 62],
      ['Codex', null],
    ]);
  });

  it('falls back to the Energy windows', () => {
    expect(energyCards(base)).toEqual([
      { key: 'week', name: 'This week', usedPercent: 40, resetsAt: '2026-11-27T09:00:00Z' },
    ]);
    expect(energyCards(undefined)).toEqual([]);
  });
});
