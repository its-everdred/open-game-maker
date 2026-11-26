/** Keep unanswered cards and answers made within the last ten minutes. */
export function keepReviewCard(answeredAt: number | undefined, now: number): boolean {
  // An unreadable timestamp must not silently discard a review.
  return answeredAt === undefined || !Number.isFinite(answeredAt) || now - answeredAt <= 10 * 60 * 1000;
}
