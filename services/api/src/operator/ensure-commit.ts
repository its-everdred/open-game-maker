import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { HttpError } from '../app/errors.js';

const exec = promisify(execFile);

async function hasCommit(checkout: string, sha: string): Promise<boolean> {
  try {
    await exec('git', ['-C', checkout, 'rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { timeout: 15000 });
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

export async function ensureCommit(checkout: string, sha: string): Promise<void> {
  if (await hasCommit(checkout, sha)) return;
  try {
    await exec('git', ['-C', checkout, '-c', 'credential.interactive=never', 'fetch', '--no-tags'], {
      timeout: 15000,
    });
  } catch {
    // A failed or timed-out fetch may still have made the commit available.
  }
  if (!(await hasCommit(checkout, sha))) throw new HttpError(409, 'unknown_commit');
}
