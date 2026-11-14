import { describe, expect, it } from 'vitest';
import { ReviewSubmission, ReviewTrack } from '../src/review-rounds.js';

const base = {
  id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
  track: 'game',
  phase: 'concept',
  ticket: '42',
  sha: 'a'.repeat(40),
};

describe('review submissions', () => {
  it('requires a capture clip with audio for sound', () => {
    expect(
      ReviewSubmission.safeParse({ ...base, category: 'sound', media: [{ kind: 'audio', ref: 'cue.wav' }] }).success,
    ).toBe(false);
    expect(
      ReviewSubmission.safeParse({
        ...base,
        category: 'sound',
        media: [{ kind: 'clip', ref: 'capture.mp4', hasAudio: true }],
      }).success,
    ).toBe(true);
  });
  it('requires a build and a design question for gameplay', () => {
    const gameplay = {
      ...base,
      category: 'gameplay',
      media: [{ kind: 'build', ref: 'preview-1' }],
      question: 'Is jumping fun?',
    };
    expect(ReviewSubmission.safeParse(gameplay).success).toBe(true);
    expect(ReviewSubmission.safeParse({ ...gameplay, question: undefined }).success).toBe(false);
    expect(ReviewSubmission.safeParse({ ...gameplay, media: [{ kind: 'still', ref: 'still.png' }] }).success).toBe(
      false,
    );
  });
  it('rejects ambiguous track phases', () => {
    expect(
      ReviewTrack.safeParse({
        id: 'art',
        phases: [
          { id: 'concept', ticket: '1', template: 'a' },
          { id: 'concept', ticket: '2', template: 'b' },
        ],
      }).success,
    ).toBe(false);
  });
});
