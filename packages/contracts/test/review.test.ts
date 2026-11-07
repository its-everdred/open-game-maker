import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { toJSONSchema, type z } from 'zod';

import {
  CommandAnswerBody,
  CommandReview,
  CommandReviewsPage,
  commandreviewsSchemas,
  ReviewAnswerPayload,
  ReviewReason,
} from '../src/review.js';
import { loadJson } from './helpers.js';

const packageRoot = new URL('../', import.meta.url);

// The review deck's contracts (A3): the like/dislike map the deck sends, the answer body that carries it, and the
// game's review ledger. Each family is paired with its fixture under fixtures/commands/, the same rule
// scripts/check-fixtures.mjs applies.
const shapes = Object.entries(commandreviewsSchemas).map(([stem, schema]) => ({ stem, schema: schema as z.ZodType }));

describe('review contract', () => {
  it.each(shapes)('$stem fixtures parse and the emitted schema is current', ({ stem, schema }) => {
    const emitted = JSON.parse(readFileSync(new URL(`schemas/${stem}.json`, packageRoot), 'utf8')) as object;
    expect(emitted).toEqual({
      ...toJSONSchema(schema, { target: 'draft-2020-12' }),
      $id: `https://open-game-maker-2000.local/schemas/${stem}.json`,
    });

    const ajv = new Ajv2020.default({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
    addFormats.default(ajv);
    const validate = ajv.compile(emitted);
    const name = /^commands\.(.+)\.v1$/.exec(stem)![1]!;
    const doc = loadJson(`fixtures/commands/${name}.json`);
    const result = schema.safeParse(doc);
    expect(result.success, `${name}: ${result.error?.message}`).toBe(true);
    expect(validate(doc), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
  });

  // The rules the deck's answer leans on: a card is judged once, a reason is real words, and the body carries no
  // field the answer route would silently drop.
  it.each([
    { file: 'review.duplicate-card.json', schema: CommandReview, path: 'dislikes' },
    { file: 'review.blank-notes.json', schema: CommandReview, path: 'notes' },
    { file: 'review-answer.unknown-field.json', schema: CommandAnswerBody, path: '' },
  ])('rejects $file at $path', ({ file, schema, path }) => {
    const result = schema.safeParse(loadJson(`fixtures/commands-negative/${file}`));
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toContain(path);
  });

  it('refuses a blank reason, so a dislike either carries the creator’s words or none', () => {
    expect(ReviewReason.safeParse('   ').success).toBe(false);
    expect(ReviewReason.safeParse('Too robotic').success).toBe(true);
  });

  it('takes a Command that asks for many as a review with more than one like', () => {
    const page = CommandReviewsPage.safeParse(loadJson('fixtures/commands/review-ledger.json'));
    expect(page.success).toBe(true);
    expect(CommandReview.safeParse(loadJson('fixtures/commands/review.json')).success).toBe(true);
  });

  // The creator's words about the whole set travel beside the per-card votes in the review and in the JSON the answer
  // puts in aiur's custom_response, so the worker sees the set-level note too.
  it('carries the whole-set notes beside the per-card votes', () => {
    const review = CommandReview.parse(loadJson('fixtures/commands/review.json'));
    expect(review.notes).toBe('All six read too young for the Blobs; keep the two warm ones and pitch them down.');

    const payload = ReviewAnswerPayload.parse(loadJson('fixtures/commands/review-answer-payload.json'));
    expect(payload.kind).toBe('question_answers');
    expect(payload.answers).toHaveLength(6);
    expect(payload.notes).toBe(review.notes);
  });

  it('leaves the whole-set notes optional, and refuses blank ones', () => {
    expect(CommandReview.safeParse({ likes: ['v1'], dislikes: [] }).success).toBe(true);
    expect(CommandReview.safeParse({ likes: ['v1'], dislikes: [], notes: '   ' }).success).toBe(false);
    expect(ReviewAnswerPayload.safeParse({ kind: 'question_answers', answers: [] }).success).toBe(true);
  });
});
