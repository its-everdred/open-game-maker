import type { CommandReview, ReviewAnswerPayload } from '@ogm/contracts';

// What a review deck's answer gives aiur's decision, shared by the two routes that can take one: a job's Command
// route and the game's own route for a registered game's Command (#573). Both call aiur's canonical Decision API, so
// the map must be built the same way or a registered game's review would read differently from a job's.
export type ReviewDecisionFields = {
  // The creator's reasoning, appended to the route's own sentence about the chosen option.
  rationale: string;
  // The likes the creator considered but did not choose. Absent when the chosen card was the only like.
  alternatives_considered?: string[];
  // The whole map as JSON text, in aiur's multi-question shape until aiur #7778 adds a structured field.
  response: string;
};

// A review judges each card of its Command at most once. Send is always on (#614), so a half-judged deck sends the
// cards it has; an invented or doubled card is refused before aiur is called.
export function reviewProblem(cards: readonly { id: string }[], review: CommandReview): string | null {
  const known = new Set(cards.map(({ id }) => id));
  const seen = new Set<string>();
  for (const id of review.likes) {
    if (!known.has(id)) return `like ${id} is not a card of this Command`;
    if (seen.has(id)) return `card ${id} is judged twice`;
    seen.add(id);
  }
  for (const { option_id: id } of review.dislikes) {
    if (!known.has(id)) return `dislike ${id} is not a card of this Command`;
    if (seen.has(id)) return `card ${id} is judged twice`;
    seen.add(id);
  }
  return null;
}

// The map as JSON text for aiur's `custom_response`. The worker reads it off the decision's answer, so it stays a flat
// object with no card labels (the option ids name the cards).
export function reviewPayload(review: CommandReview): string {
  const payload: ReviewAnswerPayload = {
    kind: 'question_answers',
    answers: [
      ...review.likes.map((option_id) => ({ option_id, verdict: 'like' as const })),
      ...review.dislikes.map(({ option_id, reason }) => ({
        option_id,
        verdict: 'dislike' as const,
        ...(reason === undefined ? {} : { reason }),
      })),
    ],
    ...(review.notes === undefined ? {} : { notes: review.notes }),
  };
  return JSON.stringify(payload);
}

// The decision fields for a review answer. `optionId` is the card the answer chose, so it is never one of aiur's
// "alternatives considered" — those are the other likes the creator kept.
export function reviewDecisionFields(
  cards: readonly { id: string; label: string }[],
  review: CommandReview,
  optionId: string,
): ReviewDecisionFields {
  const label = (id: string) => cards.find(({ id: candidate }) => candidate === id)?.label ?? id;
  const liked = review.likes.map(label).join(', ');
  const disliked = review.dislikes
    .map(({ option_id: id, reason }) => (reason === undefined ? label(id) : `${label(id)} ('${reason}')`))
    .join(', ');
  const alternatives = review.likes.filter((id) => id !== optionId);
  return {
    rationale: `Reviewed the deck: liked ${liked === '' ? 'nothing' : liked}; disliked ${disliked === '' ? 'nothing' : disliked}`,
    ...(alternatives.length === 0 ? {} : { alternatives_considered: alternatives }),
    response: reviewPayload(review),
  };
}
