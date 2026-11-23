import { describe, expect, it } from 'vitest';
import { mergePrototypeReviews, parsePrototypeReview } from '../src/prototype-review.js';

describe('prototype review summaries', () => {
  it('parses the creator-facing section', () => {
    expect(
      parsePrototypeReview(
        '## Prototype review\nPlay: https://play.example/game\nClip: https://play.example/clip.mp4\n**Works now:** walk, open chest\n**Known limitations:** no attack yet\n**Weigh in on:** enemies-first, loot-drop',
      ),
    ).toEqual({
      disposition: 'review',
      works: ['walk', 'open chest'],
      limitations: ['no attack yet'],
      decisionIds: ['enemies-first', 'loot-drop'],
    });
  });

  it('deduplicates merged capabilities and decisions while dropping resolved limitations', () => {
    expect(
      mergePrototypeReviews([
        '## Prototype review\n**Works now:** walk\n**Known limitations:** no attack, no settings\n**Weigh in on:** enemies-first',
        '## Prototype review\n**Works now:** walk, open chest\n**Known limitations:** no settings\n**Weigh in on:** enemies-first, loot-drop',
      ]),
    ).toEqual({
      disposition: 'review',
      works: ['walk', 'open chest'],
      limitations: ['no settings'],
      decisionIds: ['enemies-first', 'loot-drop'],
    });
  });

  /* The published review embeds the slice the merged PRs reviewed, so it plays in place (#1281). */
  it('carries the latest Play link scenario into the merged review', () => {
    const review = (play: string) => `## Prototype review\nPlay: ${play}   Clip: clip.mp4\n**Works now:** walk`;
    expect(
      mergePrototypeReviews([
        review('https://app.example/g/g_1?mode=edit&build=b1&scenario=town%2Flantern-dusk'),
        review('https://app.example/g/g_1?mode=edit&build=b2&scenario=goo-wave-3'),
        review('https://app.example/g/g_1?mode=edit&build=b3'),
      ]).scenario,
    ).toBe('goo-wave-3');
    expect(parsePrototypeReview(review('https://app.example/g/g_1?build=b1&scenario=../x')).scenario).toBeUndefined();
  });

  it('distinguishes explicitly non-visible changes from missing review sections', () => {
    expect(mergePrototypeReviews(['Prototype review: none', 'Prototype review: none']).disposition).toBe('none');
    expect(mergePrototypeReviews(['Prototype review: none', 'creator-visible code change']).disposition).toBe(
      'missing',
    );
  });

  /* A reason after `none` still means no review, or every such ticket posted the fallback review (#1250). */
  it('treats none with a reason as none, but not a longer word', () => {
    expect(parsePrototypeReview('Prototype review: none (mock images only; no playable change)').disposition).toBe(
      'none',
    );
    expect(parsePrototypeReview('Prototype review: none. Docs only.').disposition).toBe('none');
    expect(parsePrototypeReview('Prototype review: nonexistent').disposition).toBe('missing');
  });

  it('keeps an explicit no-limitations answer empty', () => {
    expect(mergePrototypeReviews(['## Prototype review\n**Known limitations:** none']).limitations).toEqual([]);
  });
});
