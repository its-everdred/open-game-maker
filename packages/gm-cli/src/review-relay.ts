import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewSubmission } from '@ogm/contracts';
import { CommandError } from './command.js';

export async function submitReviewRelay(
  root: string,
  slug: string,
  token: string,
  submission: ReviewSubmission,
): Promise<string> {
  const directory = join(root, '.gm', 'preview');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const requestFile = join(directory, `${id}.json`);
  const responseFile = join(directory, `${id}.response`);
  try {
    writeFileSync(
      `${requestFile}.tmp`,
      JSON.stringify({
        state: 'pending',
        kind: 'review',
        token,
        ticket: submission.ticket,
        slug,
        sha: submission.sha,
        branch: 'main',
        submission,
      }),
      { mode: 0o600, flag: 'wx' },
    );
    renameSync(`${requestFile}.tmp`, requestFile);
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      let result: { state?: string; id?: string; round?: number; error?: string };
      try {
        result = JSON.parse(readFileSync(responseFile, 'utf8')) as typeof result;
      } catch {
        continue;
      }
      if (result.state === 'failed') throw new CommandError(result.error || 'review submission refused');
      if (result.state === 'done' && result.id === submission.id && Number.isInteger(result.round))
        return JSON.stringify({ id: result.id, round: result.round });
    }
    throw new CommandError('review submission timed out waiting for the host relay');
  } finally {
    rmSync(`${requestFile}.tmp`, { force: true });
    rmSync(requestFile, { force: true });
    rmSync(responseFile, { force: true });
  }
}
