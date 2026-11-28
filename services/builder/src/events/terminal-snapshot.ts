import type { IssueEntry } from '@ogm/aiur-client';

// A daemon snapshot can be stale; terminal states still need tracker confirmation.
export function terminalSnapshot(issue: IssueEntry): boolean {
  const idle = issue.idle;
  const side = issue.running ?? issue.retry ?? (typeof idle === 'object' && idle !== null ? idle : undefined);
  if (!side || !('state' in side) || typeof side.state !== 'string') return false;
  const state = side.state
    .trim()
    .toLowerCase()
    .replace(/^[^:\s]+:\s*/, '')
    .replace(/\s+/g, '-');
  return ['done', 'cancelled', 'canceled'].includes(state);
}
