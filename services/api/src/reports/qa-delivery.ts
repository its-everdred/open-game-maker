import type { AiurClient } from '@ogm/aiur-client';

/** Issue contents contain only identifiers; player text and attachments stay behind report.view. */
export function qaIssue(input: {
  reportId: string;
  gameId: string;
  buildHash?: string;
  errorType?: string;
  appOrigin: string;
}) {
  const reportUrl = new URL(`/api/v1/reports/${encodeURIComponent(input.reportId)}`, input.appOrigin);
  const bundleUrl = new URL(`${reportUrl.pathname}/bundle`, reportUrl);
  const screenshotUrl = new URL(`${reportUrl.pathname}/screenshot`, reportUrl);
  const errorType = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError'].find(
    (type) => type === input.errorType,
  );
  return {
    gameId: input.gameId,
    title: 'Bug report',
    body: `${input.buildHash ? `Build: ${input.buildHash}` : 'Build: see private report'}${errorType ? `\nError: ${errorType}` : ''}\n\n[Private report and logs](${reportUrl.href})\n[Private screenshot, if captured](${screenshotUrl.href})\n[Private bundle, if attached](${bundleUrl.href})`,
    labels: ['needs-triage'],
  };
}

/** The idempotency key is stable across delivery retries. */
export async function notifyQaIssue(
  client: Pick<AiurClient, 'sendExecutorThreadMessage'>,
  input: { reportId: string; gameId: string; repository: string; ref: string },
): Promise<void> {
  const result = await client.sendExecutorThreadMessage(
    {
      text: `A bug report for game ${input.gameId} was filed for triage in ${input.repository} (${input.ref}).`,
      client_request_id: `qa-report:${input.reportId}`,
    },
    AbortSignal.timeout(30_000),
  );
  if (result.delivery === 'outcome_unknown') throw new Error('notification_outcome_unknown');
}
