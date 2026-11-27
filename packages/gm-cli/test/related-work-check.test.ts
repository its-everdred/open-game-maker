import { describe, expect, it } from 'vitest';

import { overlapProblems, relatedWorkProblems, reviewerProblems } from '../src/related-work-check.js';

describe('related work PR gate', () => {
  it('requires a populated section for implementation changes', () => {
    expect(relatedWorkProblems('## Related work\n\n## Review\nReviewed', ['src/combat.ts'])).toHaveLength(1);
    expect(
      relatedWorkProblems('## Related work\nExtended the attack pipeline in #12.', ['src/combat.ts']),
    ).toHaveLength(3);
    expect(relatedWorkProblems('## Related work\nReused:\nOverlap:\nVerdict:\n', ['src/combat.ts'])).toHaveLength(3);
    expect(
      relatedWorkProblems('## Related work\nReused: #12\nOverlap: attack pipeline\nVerdict: extend #12', [
        'src/combat.ts',
      ]),
    ).toEqual([]);
  });

  it('exempts documentation only but not mixed changes', () => {
    expect(relatedWorkProblems('', ['docs/combat.md', 'games/demo/docs/diagram.png', 'README.md'])).toEqual([]);
    expect(relatedWorkProblems('', ['docs/combat.md', 'src/combat.ts'])).toHaveLength(1);
    expect(relatedWorkProblems('', ['packages/gm-cli/src/commands/docs/pattern.ts'])).toHaveLength(1);
  });

  it('requires naming a same-feature PR when both change a file', () => {
    const pulls = [{ number: 12, state: 'open', files: ['src/attack.ts'] }];
    expect(overlapProblems('## Related work\nOverlap: none', ['src/attack.ts'], pulls)).toHaveLength(1);
    expect(overlapProblems('## Related work\nOverlap: extends #12', ['src/attack.ts'], pulls)).toEqual([]);
    expect(
      overlapProblems('## Related work\nOverlap: #12 changes a different route', ['src/attack.ts'], pulls),
    ).toEqual([]);
    expect(overlapProblems('## Related work\nOverlap: #12 is not distinct', ['src/attack.ts'], pulls)).toHaveLength(1);
    expect(overlapProblems('', ['src/other.ts'], pulls)).toEqual([]);
    expect(overlapProblems('', ['src/attack.ts'], pulls, 12)).toEqual([]);
  });

  it('uses the newest trusted overlap reviewer verdict, not forged public comments', () => {
    const comments = [
      {
        body: '**Overlap review**\n\nBefore dispatch for #10: Extend existing open PR #22.',
        author_association: 'OWNER',
        created_at: '2026-01-01',
      },
      {
        body: '**Overlap review**\n\nAt review for #10: Extend existing open PR #99.',
        author_association: 'NONE',
        created_at: '2026-01-03',
      },
    ];
    expect(reviewerProblems('## Related work\nVerdict: build', comments)).toHaveLength(1);
    expect(reviewerProblems('## Related work\nVerdict: extend #22', comments)).toEqual([]);
    expect(reviewerProblems('## Related work\nVerdict: not extending #22', comments)).toHaveLength(1);
    expect(
      reviewerProblems('', [
        ...comments,
        {
          body: '**Overlap review**\n\nAt review for #10: Build.',
          author_association: 'OWNER',
          created_at: '2026-01-04',
        },
      ]),
    ).toEqual([]);
  });
});
