import { z } from 'zod';

import { Id, IsoTime } from './api.js';

// The review deck (A3): a Command whose options carry media is reviewed one card at a time. The creator swipes or
// taps thumbs up/down on each card, may give a reason on a dislike, and the answer carries the whole like/dislike map
// back through the job's Command route. The cards are the Command's option ids, so every id here is validated
// against the Command before anything is written.
export const MAX_REVIEW_CARDS = 12;
export const ReviewReason = z.string().trim().min(1).max(1000);
// The creator's words about the set as a whole, beside the per-card votes: "these are too young for the Blobs" applies
// to every voice, so it belongs to the review rather than to one card.
export const ReviewNotes = z.string().trim().min(1).max(2000);

export const ReviewDislike = z
  .object({
    option_id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    // The creator's words for a dislike they explained. Absent when they just swiped left.
    reason: ReviewReason.optional(),
  })
  .strict();

export const CommandReview = z
  .object({
    likes: z.array(z.string().regex(/^[a-z0-9_-]{1,32}$/)).max(MAX_REVIEW_CARDS),
    dislikes: z.array(ReviewDislike).max(MAX_REVIEW_CARDS),
    // Anything that applies to the whole set rather than one card. Absent when the creator said nothing extra.
    notes: ReviewNotes.optional(),
  })
  .strict()
  .superRefine((review, ctx) => {
    const seen = new Set<string>();
    for (const id of review.likes) {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['likes'], message: `duplicate card ${id}` });
      seen.add(id);
    }
    for (const { option_id: id } of review.dislikes) {
      if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['dislikes'], message: `duplicate card ${id}` });
      seen.add(id);
    }
  });

// POST /api/v1/jobs/:jobId/commands/:commandId/answer body. `review` is present only for a deck answer; the
// option id is the Command's pick (the tapped shortlist card, or the first like when the Command asks for many).
export const CommandAnswerBody = z
  .object({
    option_id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    review: CommandReview.optional(),
  })
  .strict();

// One entry in the game's review ledger: a deck answer with the Command, every card's label and the creator's reasons.
export const ReviewLedgerCard = z.object({
  option_id: z.string().min(1).max(32),
  label: z.string().min(1).max(200),
});

export const ReviewLedgerDislike = ReviewLedgerCard.extend({ reason: ReviewReason.nullable() });

export const CommandReviewEntry = z.object({
  id: Id,
  game_id: Id,
  // The job that owns the Command; null for a registered game's Command, which no job owns (#573).
  job_id: Id.nullable(),
  // The aiur ticket the Command belongs to; null until the job is linked.
  ticket: z.string().nullable(),
  title: z.string().trim().min(1).max(200),
  command_id: z.string().min(1).max(200),
  decision_id: z.string().min(1).max(200),
  question: z.string().trim().min(1).max(8000),
  // The option the Command was answered with: the tapped shortlist card, or the first like.
  option_id: z.string().min(1).max(32),
  likes: z.array(ReviewLedgerCard).max(MAX_REVIEW_CARDS),
  dislikes: z.array(ReviewLedgerDislike).max(MAX_REVIEW_CARDS),
  // The creator's words about the whole set, beside the per-card reasons; null when they said nothing extra.
  notes: ReviewNotes.nullable(),
  at: IsoTime,
});

// What a deck answer puts in aiur's `custom_response` beside the chosen option id: the whole map as JSON text, in the
// multi-question shape aiur uses (`{kind: "question_answers", ...}`) until aiur #7778 adds a structured field. The
// worker reads it off the decision's answer, so it must stay a flat, self-describing object.
export const ReviewAnswerPayload = z
  .object({
    kind: z.literal('question_answers'),
    answers: z
      .array(
        z
          .object({
            option_id: z.string().min(1).max(32),
            verdict: z.enum(['like', 'dislike']),
            reason: ReviewReason.optional(),
          })
          .strict(),
      )
      .max(MAX_REVIEW_CARDS),
    notes: ReviewNotes.optional(),
  })
  .strict();

// GET /api/v1/games/:gameId/reviews → the game's review ledger, newest first.
export const CommandReviewsPage = z.object({ reviews: z.array(CommandReviewEntry) });

export type ReviewDislike = z.infer<typeof ReviewDislike>;
export type CommandReview = z.infer<typeof CommandReview>;
export type CommandAnswerBody = z.infer<typeof CommandAnswerBody>;
export type ReviewLedgerCard = z.infer<typeof ReviewLedgerCard>;
export type ReviewLedgerDislike = z.infer<typeof ReviewLedgerDislike>;
export type CommandReviewEntry = z.infer<typeof CommandReviewEntry>;
export type CommandReviewsPage = z.infer<typeof CommandReviewsPage>;
export type ReviewAnswerPayload = z.infer<typeof ReviewAnswerPayload>;

// The emit script picks up `<lowercase>Schemas` maps, so the multiword family follows `design-decisions.ts`'s pattern:
// the lowercase name is what gets emitted and the readable name is the alias.
export const commandreviewsSchemas = {
  'commands.review.v1': CommandReview,
  'commands.review-answer.v1': CommandAnswerBody,
  'commands.review-answer-payload.v1': ReviewAnswerPayload,
  'commands.review-ledger.v1': CommandReviewsPage,
} satisfies Record<string, z.ZodType>;
export const commandReviewsSchemas = commandreviewsSchemas;
