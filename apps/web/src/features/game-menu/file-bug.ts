import type { CreateJobRequest } from '@ogm/contracts';

import { editJobRequest } from '../build-chat/edit';

type Admit = (
  request: CreateJobRequest,
) => Promise<{ kind: 'accepted'; jobId: string } | { kind: 'refused' } | { kind: string }>;
type Report = (input: { text: string }) => Promise<unknown>;

/** The report route caps a report's text; the description comes first so the log is what gets cut. */
export const REPORT_TEXT_MAX = 2000;

/**
 * Files a bug from the play menu (#1326). The owner's becomes a fix request with an agent they can keep talking to:
 * its `edit:` key makes the bug the conversation's first message, and one key per bug lets a retry after a lost
 * response land on the same job. Anyone else's goes to the report route, whose repair job they cannot open, so it
 * offers no conversation.
 */
export async function fileBug(
  deps: { admit: Admit; report: Report },
  target: { gameId: string; branchId: string; owner: boolean },
  bug: { text: string; log: string; attempt: string },
): Promise<{ jobId?: string }> {
  if (target.owner) {
    const request = editJobRequest(target, `Bug: ${bug.text}\n\nLog:\n${bug.log}`, 'now', `edit:bug-${bug.attempt}`);
    const line = `Bug: ${bug.text.replace(/\s+/g, ' ').trim()}`;
    const result = await deps.admit({
      ...request,
      plan: { ...request.plan, title: line.length > 120 ? `${line.slice(0, 119)}…` : line },
    });
    if (result.kind !== 'accepted' || !('jobId' in result)) throw new Error('bug_not_admitted');
    return { jobId: result.jobId };
  }
  await deps.report({ text: `${bug.text}\n\n${bug.log}`.slice(0, REPORT_TEXT_MAX) });
  return {};
}
