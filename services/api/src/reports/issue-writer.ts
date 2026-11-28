import { randomUUID } from 'node:crypto';

import type { IssueWriter } from '@ogm/contracts';
import { schema, type Db } from '@ogm/db';
import { isDaemonLabel } from '@ogm/game-repo-template';

type IssueInput = Parameters<IssueWriter['file']>[0];

// Platform issues never carry a label aiur acts on: user text must not drive a daemon with platform write access. A
// game daemon's labels are prefixed with its game slug (`castle-run:todo`), so the check reads the suffix, not `agent:`.
function assertNoDispatchLabel(input: IssueInput): void {
  if (input.labels.some(isDaemonLabel)) throw new Error('platform issues never carry agent labels');
}

// V1 default: the operator reads the queue (GET /api/v1/reports/platform-queue).
export class StoredIssueWriter implements IssueWriter {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async file(input: IssueInput): Promise<{ ref: string }> {
    assertNoDispatchLabel(input);
    const id = `piq_${randomUUID()}`;
    this.db
      .insert(schema.platformIssueQueue)
      .values({
        id,
        title: input.title,
        body: input.body,
        labelsJson: JSON.stringify(input.labels),
        status: 'pending',
        createdAt: this.now().toISOString(),
      })
      .run();
    return { ref: `queue:${id}` };
  }
}

// D-COMMIT: only the commit service holds the GitHub credential, so filing goes through its `file_issue` op.
export class CommitServiceIssueWriter implements IssueWriter {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(input: { baseUrl: string; token: string; fetch?: typeof fetch }) {
    this.#baseUrl = input.baseUrl.replace(/\/$/, '');
    this.#token = input.token;
    this.#fetch = input.fetch ?? fetch;
  }

  async file(input: IssueInput): Promise<{ ref: string }> {
    assertNoDispatchLabel(input);
    const response = await this.#fetch(`${this.#baseUrl}/internal/commit`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'file_issue',
        title: input.title,
        body: input.body,
        labels: input.labels,
        ...(input.gameId ? { gameId: input.gameId } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.reconcile ? { reconcile: true } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = (await response.json().catch(() => null)) as { ok?: boolean; sha?: string } | null;
    if (!response.ok || result?.ok !== true || typeof result.sha !== 'string' || !/^issue:[1-9]\d*$/.test(result.sha)) {
      throw new Error(`commit service refused file_issue (${response.status})`);
    }
    return { ref: result.sha };
  }
}
