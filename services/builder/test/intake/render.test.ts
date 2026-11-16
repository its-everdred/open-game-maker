import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderIssue, renderRepairIssue, usdFromMicro } from '../../src/intake/render.js';

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/issue-body.md', import.meta.url)), 'utf8').trimEnd();

const plan = {
  title: 'Add a double jump',
  summary: 'The player can jump again once in the air.',
  scope: { included: ['jump buffer, coyote time'], excluded: ['wall jump'] },
  tickets: [
    {
      key: 't1',
      skills: ['gm-genre-platformer', 'not-shipped'],
      dependsOn: ['setup'],
      acceptanceCriteria: ['`gm test` is green'],
    },
  ],
};

describe('renderIssue', () => {
  it('renders deterministic transcript-free issue text and labels', () => {
    const first = renderIssue({
      jobId: 'j_01JBQ5X7',
      complexity: 3,
      plan,
      ticket: plan.tickets[0]!,
      blockedBy: [41],
      shippedSkills: ['gm-core', 'gm-verify', 'gm-genre-platformer'],
    });
    const second = renderIssue({
      jobId: 'j_01JBQ5X7',
      complexity: 3,
      plan,
      ticket: plan.tickets[0]!,
      blockedBy: [41],
      shippedSkills: ['gm-core', 'gm-verify', 'gm-genre-platformer'],
    });

    expect(first).toEqual(second);
    expect(first.title).toBe('Add a double jump');
    expect(first.body).toBe(fixture);
    expect(first.labels).toEqual(['complexity:3', 'feature:gm-j_01JBQ5X7', 'phase:mock', 'model:low']);
    expect(first.body).not.toContain('not-shipped');
    expect(first.body).not.toContain('@');
  });

  it('rejects email-shaped content before it reaches GitHub', () => {
    expect(() =>
      renderIssue({
        jobId: 'j_1',
        complexity: 2,
        plan: { ...plan, summary: 'Contact maker@example.com' },
        ticket: plan.tickets[0]!,
        blockedBy: [],
        shippedSkills: ['gm-core'],
      }),
    ).toThrow(/email/i);
  });

  it('formats positive micro-USD values with no more than six fraction digits', () => {
    expect(usdFromMicro(0)).toBe('0.000001');
    expect(usdFromMicro(1)).toBe('0.000001');
    expect(usdFromMicro(1_250_000)).toBe('1.25');
    expect(usdFromMicro(9_000_001)).toBe('9.000001');
  });
});

describe('renderRepairIssue', () => {
  it('drops the failing daemon’s own labels, including a game-prefixed state, and keeps the reporter’s', () => {
    const rendered = renderRepairIssue({
      jobId: 'j_2',
      complexity: 2,
      ticket: {
        title: 'Platform TypeError',
        body: 'Signature x',
        labels: ['castle-run:todo', 'agent:ci-wait', 'complexity:3', 'feature:gm-j_1', 'bug', 'source:report'],
      },
    });

    expect(rendered.labels).toEqual(['complexity:2', 'feature:gm-j_2', 'bug', 'source:report']);
  });
});
