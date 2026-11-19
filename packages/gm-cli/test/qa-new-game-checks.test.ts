import { describe, expect, it } from 'vitest';

import { cleanupFailure, parentFailure } from '../src/qa-new-game-checks.js';

describe('New Game parent verification', () => {
  const turns = ['QA private first turn', 'QA private second turn'];
  const context = {
    request: 'j_qa-123',
    game: { id: 'g_qa-123' },
    parent: { repo: 'owner/games', number: 42 },
    messages: turns.map((text) => ({ actor: 'creator', text })),
  };
  const issue = {
    number: 42,
    repo: 'owner/games',
    title: 'A game',
    labels: ['request:new-game'],
    body: '## Creation choices\n- Genre: Adventure\n\nBrief: A game.\n\n- Game: g_qa-123\n- Private context reference: j_qa-123',
  };

  it('requires one parent with the opaque reference and both creator turns in private context', () => {
    expect(parentFailure([issue], context, 'g_qa-123', turns)).toBeNull();
    expect(parentFailure([issue, issue], context, 'g_qa-123', turns)).toMatch(/exactly one/);
    expect(parentFailure([{ ...issue, body: `${issue.body}\n${turns[0]}` }], context, 'g_qa-123', turns)).toMatch(
      /raw/,
    );
    const canaryTurns = ['The first message contains qa-private-canary-one', turns[1]!];
    expect(
      parentFailure([{ ...issue, body: `${issue.body}\nQA-PRIVATE-CANARY-ONE` }], context, 'g_qa-123', canaryTurns),
    ).toMatch(/raw/);
    const longTurn = 'Explore a quiet forest and find a hidden lantern before the moon rises.';
    expect(
      parentFailure(
        [{ ...issue, body: `${issue.body}\nquiet forest and find a hidden lantern before` }],
        { ...context, messages: [{ actor: 'creator', text: longTurn }] },
        'g_qa-123',
        [longTurn],
      ),
    ).toMatch(/raw/);
    expect(parentFailure([{ ...issue, labels: [...issue.labels, 'agent:todo'] }], context, 'g_qa-123', turns)).toMatch(
      /dispatch/,
    );
    expect(
      parentFailure([{ ...issue, labels: [...issue.labels, 'qa-test:todo'] }], context, 'g_qa-123', turns),
    ).toMatch(/dispatch/);
    expect(parentFailure([issue], { ...context, messages: context.messages.slice(0, 1) }, 'g_qa-123', turns)).toMatch(
      /private context/,
    );
    expect(
      parentFailure([issue], { ...context, parent: { ...context.parent, number: 43 } }, 'g_qa-123', turns),
    ).toMatch(/parent/);
  });
});

describe('New Game cleanup safety', () => {
  const report = {
    game: { id: 'g_qa-123', slug: 'qa-test', path: 'games/qa-test', repoUrl: 'https://github.com/example/games' },
    daemon: null,
    tickets: [{ jobId: 'j_qa-123', key: 'new-game', repo: 'example/games', issue: 42 }],
    sessions: [],
    jobs: [
      {
        id: 'j_qa-123',
        kind: 'new_game',
        state: 'cancelled',
        releasedAt: '2026-01-01',
        repo: 'example/games',
        issue: 42,
      },
    ],
  };

  it('refuses paths, repositories, or active jobs that cannot be safely cleaned up', () => {
    expect(cleanupFailure(report, 'example/games')).toBeNull();
    expect(
      cleanupFailure(
        { ...report, tickets: [{ jobId: 'j_qa-123', key: 'scope', repo: 'example/games', issue: 42 }] },
        'example/games',
      ),
    ).toMatch(/scope session/);
    expect(cleanupFailure({ ...report, game: { ...report.game, path: 'games/../other' } }, 'example/games')).toMatch(
      /folder/,
    );
    expect(
      cleanupFailure(
        { ...report, game: { ...report.game, repoUrl: 'https://github.com/other/games' } },
        'example/games',
      ),
    ).toMatch(/repository/);
    expect(cleanupFailure({ ...report, jobs: [{ ...report.jobs[0]!, state: 'running' }] }, 'example/games')).toMatch(
      /active/,
    );
    expect(cleanupFailure({ ...report, jobs: [{ ...report.jobs[0]!, kind: 'feature' }] }, 'example/games')).toMatch(
      /unexpected/,
    );
  });
});
