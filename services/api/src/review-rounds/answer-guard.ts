// Keep a just-answered ticket out of missing-review reporting until the tracker observes it leave review.
// The key is scoped by source so different games and the core can use the same ticket number.
const pending = new Map<string, Set<string>>();
export function markReviewAnswered(source: string, ticket: string): void {
  const tickets = pending.get(source) ?? new Set<string>();
  if (!tickets.has(ticket) && tickets.size >= 2000) tickets.delete(tickets.values().next().value!);
  tickets.add(ticket);
  pending.set(source, tickets);
}
export function reviewAnswerPending(source: string, ticket: string): boolean {
  return pending.get(source)?.has(ticket) ?? false;
}
export function observeReviewState(source: string, ticket: string, isReview: boolean): void {
  if (!isReview) pending.get(source)?.delete(ticket);
}
export function retainReviewTickets(source: string, tickets: ReadonlySet<string>): void {
  for (const ticket of pending.get(source) ?? []) if (!tickets.has(ticket)) pending.get(source)?.delete(ticket);
}
