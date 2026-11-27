import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { CommandError, type GmContext } from './command.js';

const exec = promisify(execFile);

/** Run a bounded, argument-vector-only context read without hiding the underlying diagnostic. */
export async function workRead(ctx: GmContext, program: string, args: string[], cwd = ctx.cwd): Promise<string> {
  try {
    return (
      await exec(program, args, {
        cwd,
        env: { ...ctx.env, GH_PROMPT_DISABLED: '1' },
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      })
    ).stdout;
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
    throw new CommandError(`${program} failed: ${failure.stderr?.trim() || failure.message || 'unknown error'}`);
  }
}

/** GitHub caps PR file listings; reject an incomplete list rather than approving an unchecked overlap. */
export async function pullFiles(ctx: GmContext, number: number): Promise<string[]> {
  if (!Number.isSafeInteger(number) || number < 1) throw new CommandError('invalid PR number');
  const detail = JSON.parse(await workRead(ctx, 'gh', ['api', `repos/{owner}/{repo}/pulls/${number}`])) as {
    changed_files?: unknown;
  };
  const files = (
    await workRead(ctx, 'gh', [
      'api',
      '--paginate',
      `repos/{owner}/{repo}/pulls/${number}/files?per_page=100`,
      '--jq',
      '.[].filename | tojson',
    ])
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
  if (
    typeof detail.changed_files !== 'number' ||
    detail.changed_files !== files.length ||
    files.some((file) => typeof file !== 'string')
  )
    throw new CommandError(
      `cannot verify all files for PR #${number}: expected ${String(detail.changed_files)}, received ${files.length}`,
    );
  return files as string[];
}
