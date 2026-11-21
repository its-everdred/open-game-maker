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
  it('accepts one named concept target alongside the work but not a target alone', () => {
    const target = { kind: 'still', ref: 'target.png', role: 'target' };
    const work = { kind: 'still', ref: 'work.png' };
    expect(ReviewSubmission.safeParse({ ...base, category: 'art', media: [target, work] }).success).toBe(true);
    expect(ReviewSubmission.safeParse({ ...base, category: 'art', media: [target] }).success).toBe(false);
    expect(ReviewSubmission.safeParse({ ...base, category: 'art', media: [target, target, work] }).success).toBe(false);
  });
  it('accepts per-media provenance metadata', () => {
    const value = { kind: 'image generation', model: 'gpt-image-1', cost_usd: 0.04 };
    expect(
      ReviewSubmission.safeParse({
        ...base,
        category: 'art',
        media: [
          { kind: 'still', ref: 'target.png', role: 'target' },
          { kind: 'still', ref: 'work.png', meta: value },
        ],
      }).success,
    ).toBe(true);
  });
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
  it('validates creator-facing prototype review content and its ticket targets', () => {
    const prototype = {
      ...base,
      track: 'prototype-publish',
      phase: 'build',
      category: 'gameplay',
      question: 'Review this published build',
      media: [{ kind: 'build', ref: 'build_1' }],
      works: ['Walk around the town'],
      limitations: ['No attack yet'],
      decisionIds: ['enemy-lineup'],
      sourceTickets: ['42', '43'],
      clipStatus: 'unchecked',
    };
    expect(ReviewSubmission.safeParse(prototype).success).toBe(true);
    expect(ReviewSubmission.safeParse({ ...prototype, sourceTickets: ['42', '42'] }).success).toBe(false);
    expect(ReviewSubmission.safeParse({ ...prototype, decisionIds: ['enemy-lineup', 'enemy-lineup'] }).success).toBe(
      false,
    );
  });
  it('accepts audio and stills for mock rounds while keeping later rung requirements', () => {
    expect(
      ReviewSubmission.safeParse({
        ...base,
        phase: 'mock',
        category: 'sound',
        media: [{ kind: 'audio', ref: 'cue.wav' }],
      }).success,
    ).toBe(true);
    const mock = {
      ...base,
      phase: 'mock',
      category: 'gameplay',
      media: [{ kind: 'still', ref: 'mock.png' }],
      question: 'Which?',
    };
    expect(ReviewSubmission.safeParse(mock).success).toBe(true);
    expect(ReviewSubmission.safeParse({ ...mock, phase: 'build' }).success).toBe(false);
  });
  it('rejects ambiguous track phases', () => {
    expect(
      ReviewTrack.safeParse({
        id: 'art',
        category: 'art',
        phases: [
          { id: 'concept', ticket: '1', template: 'a' },
          { id: 'concept', ticket: '2', template: 'b' },
        ],
      }).success,
    ).toBe(false);
  });
  it('accepts supported explicit phase efforts and rejects unknown efforts', () => {
    const track = { id: 'art', category: 'art', phases: [{ id: 'mock', template: 'mock', effort: 'xhigh' }] };
    expect(ReviewTrack.safeParse(track).success).toBe(true);
    expect(ReviewTrack.safeParse({ ...track, phases: [{ ...track.phases[0], effort: 'ultra' }] }).success).toBe(false);
  });
  it('permits skipped fidelity rungs but rejects reordering', () => {
    const phase = (id: string) => ({ id, template: id });
    const track = { id: 'art', category: 'art', phases: [phase('mock'), phase('build')] };
    expect(ReviewTrack.safeParse(track).success).toBe(true);
    expect(ReviewTrack.safeParse({ ...track, phases: [...track.phases].reverse() }).success).toBe(false);
    expect(ReviewTrack.safeParse({ ...track, phases: [phase('build'), phase('custom')] }).success).toBe(false);
    expect(
      ReviewTrack.safeParse({ ...track, phases: ['one', 'two', 'three', 'four', 'five'].map(phase) }).success,
    ).toBe(true);
  });
});
