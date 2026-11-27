import type { CreateJobRequest } from '@ogm/contracts';

import type { BugCapture } from './BugComposer';
import { editJobRequest } from '../build-chat/edit';
import { uploadChatAttachment } from '../build-chat/attachments';
import { api } from '../../lib/api/client';

type Admit = (
  request: CreateJobRequest,
) => Promise<{ kind: 'accepted'; jobId: string } | { kind: 'refused' } | { kind: string }>;
type Report = (input: { text: string; captures?: BugCapture[] }) => Promise<unknown>;

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
  bug: { text: string; log: string; attempt: string; captures?: BugCapture[] },
): Promise<{ jobId?: string }> {
  if (target.owner) {
    const request = editJobRequest(target, `Bug: ${bug.text}\n\nLog:\n${bug.log}`, 'now', `edit:bug-${bug.attempt}`);
    const line = `Bug: ${bug.text.replace(/\s+/g, ' ').trim()}`;
    const result = await deps.admit({
      ...request,
      plan: { ...request.plan, title: line.length > 120 ? `${line.slice(0, 119)}…` : line },
    });
    if (result.kind !== 'accepted' || !('jobId' in result)) throw new Error('bug_not_admitted');
    if (bug.captures?.length) {
      try {
        await attachCaptures(result.jobId, bug.captures);
      } catch {
        // Keep the admitted bug conversation available when attachment storage is temporarily unavailable.
      }
    }
    return { jobId: result.jobId };
  }
  await deps.report({ text: `${bug.text}\n\n${bug.log}`.slice(0, REPORT_TEXT_MAX), captures: bug.captures });
  return {};
}

async function attachCaptures(jobId: string, captures: BugCapture[]): Promise<void> {
  const requestDeadline = AbortSignal.timeout(10_000);
  const uploadDeadline = AbortSignal.any([requestDeadline, AbortSignal.timeout(7_000)]);
  const results = await Promise.allSettled(
    captures.slice(0, 3).map(async ({ label, image }) => {
      const encoded = image.slice(image.indexOf(',') + 1);
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '');
      const name = `game-${slug}.webp`;
      const file = new File([bytes], name, { type: 'image/webp' });
      return uploadChatAttachment(jobId, file, 'image/webp', uploadDeadline);
    }),
  );
  const attachments = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  if (attachments.length === 0) throw new Error('bug_capture_upload_failed');
  await api(`/jobs/${encodeURIComponent(jobId)}/chat`, {
    method: 'POST',
    json: { text: 'Recent game screenshots', attachments: attachments.map(({ id }) => id) },
    signal: requestDeadline,
  });
}
