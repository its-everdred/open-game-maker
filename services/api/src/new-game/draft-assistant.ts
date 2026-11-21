import { createHash } from 'node:crypto';

import type { AiurClient } from '@ogm/aiur-client';
import type { ScopeChoices } from '@ogm/contracts';
import type { IssuesClient } from '@ogm/builder';

export type DraftScopeTicket = { repo: string; ticket: string };

export async function createDraftScopeTicket(input: {
  repo: string;
  draftId: string;
  choices: ScopeChoices;
  issues: Pick<IssuesClient, 'create' | 'ensureLabel' | 'findByMarkers' | 'close'>;
  aiur: Pick<AiurClient, 'enqueueTodo'>;
}): Promise<DraftScopeTicket> {
  const marker = `<!-- gm-job:${input.draftId} gm-ticket:scope gm-sig:${createHash('sha256').update(input.draftId).digest('hex')} -->`;
  await input.issues.ensureLabel(input.repo, `feature:gm-${input.draftId}`, '0e8a16', 'Temporary scope session');
  const existing = await input.issues.findByMarkers(input.repo, input.draftId, 'scope');
  let issue: { number: number; url: string } | null = existing;
  if (issue === null) {
    try {
      issue = await input.issues.create(input.repo, {
        title: 'Temporary game scope conversation',
        body: [
          'This is a temporary, pre-Finish scope conversation. The creator has not created a game yet.',
          'Use the shared assistant to discuss and refine the game scope with the creator.',
          'Do not create or modify files, branches, commits, or pull requests. Do not provision a game repository or daemon.',
          'When the creator agrees, reply with the complete agreed scope as JSON in a fenced `ogm-scope` block.',
          'The JSON must include `session_id`, `revision: 1`, `title`, `summary`, `scope`, `tickets`, `complexity`, `open_questions`, and `ideas`.',
          `Draft id: ${input.draftId}`,
          'Creator choices:',
          '```json',
          JSON.stringify(input.choices, null, 2),
          '```',
          marker,
        ].join('\n\n'),
        labels: ['agent:todo', 'complexity:1', `feature:gm-${input.draftId}`],
      });
    } catch (error) {
      // The issue may have been created even when GitHub's response was lost; close the marker match so the failed
      // draft cannot leave an unowned assistant ticket in the shared queue.
      const ambiguous = await input.issues.findByMarkers(input.repo, input.draftId, 'scope').catch(() => null);
      if (ambiguous && input.issues.close)
        await input.issues.close(input.repo, ambiguous.number).catch(() => undefined);
      throw error;
    }
  }
  if (issue === null) throw new Error('draft_scope_issue_missing');
  try {
    await input.aiur.enqueueTodo([String(issue.number)]);
  } catch (error) {
    if (input.issues.close) await input.issues.close(input.repo, issue.number).catch(() => undefined);
    throw error;
  }
  return { repo: input.repo, ticket: String(issue.number) };
}
