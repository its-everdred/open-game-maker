import { z } from 'zod';

import { IsoTime } from './api.js';
import { MAX_REVIEW_CARDS, ReviewReason } from './review.js';

// A review deck's draft (#631): the votes saved on the server as the creator casts them, so leaving midway keeps them
// and the Command is answered once every card has a vote. The key is the Command's checkpoint id and version, so a
// Command reopened at a new version starts with no votes.
const OptionId = z.string().regex(/^[a-z0-9_-]{1,32}$/);

export const ReviewDraftKey = z.string().regex(/^[A-Za-z0-9_.:-]{1,240}$/);

export const ReviewDraftDeck = z
  .object({
    // The cards judged so far, oldest first: undo takes the last one back.
    cards: z
      .array(
        z
          .object({ option_id: OptionId, verdict: z.enum(['like', 'dislike']), reason: ReviewReason.optional() })
          .strict(),
      )
      .max(MAX_REVIEW_CARDS),
  })
  .strict();

// PUT /api/v1/games/:gameId/review-drafts/:key body.
export const ReviewDraftBody = z.object({ deck: ReviewDraftDeck }).strict();

// GET /api/v1/games/:gameId/review-drafts → the signed-in creator's drafts for the game.
export const ReviewDraftsPage = z.object({
  drafts: z.array(z.object({ key: ReviewDraftKey, deck: ReviewDraftDeck, updated_at: IsoTime })),
});

export type ReviewDraftDeck = z.infer<typeof ReviewDraftDeck>;
export type ReviewDraftBody = z.infer<typeof ReviewDraftBody>;
export type ReviewDraftsPage = z.infer<typeof ReviewDraftsPage>;

export const reviewdraftsSchemas = {
  'commands.review-draft.v1': ReviewDraftBody,
  'commands.review-drafts.v1': ReviewDraftsPage,
} satisfies Record<string, z.ZodType>;
export const reviewDraftsSchemas = reviewdraftsSchemas;
