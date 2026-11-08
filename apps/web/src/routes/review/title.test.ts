import { describe, expect, it } from 'vitest';

import { reviewTitle } from './title';

// Kevin's phone showed a whole question as the review's heading (#594): the heading is a topic of a few words.
describe('reviewTitle', () => {
  it('keeps a short summary as it is', () => {
    expect(reviewTitle('Pick a voice')).toBe('Pick a voice');
    expect(reviewTitle('  Vision checks ')).toBe('Vision checks');
  });

  it('cuts a whole question to its first five words', () => {
    expect(
      reviewTitle('Which of these two voices should the Blobs use for their idle chatter, given the narrator?'),
    ).toBe('Which of these two voices…');
  });

  it('drops the punctuation the cut lands on', () => {
    expect(reviewTitle('Pick a voice, a look, or both for the Blobs')).toBe('Pick a voice, a look…');
  });

  it('keeps five long words inside the width a phone heading holds', () => {
    const title = reviewTitle('Internationalisation localisation considerations notwithstanding everything');
    expect(title.length).toBeLessThanOrEqual(29);
    expect(title.endsWith('…')).toBe(true);
  });
});
