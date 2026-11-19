import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { GitHubRequest } from './qa-new-game-folder-github.js';

export class QaGitHubError extends Error {
  constructor(readonly status?: number) {
    super(status ? `GitHub request returned ${status}` : 'GitHub request failed');
  }
}

/** Send JSON via a private scratch file, not shell interpolation or command-line arguments. */
export function qaGitHubRequest(env?: Record<string, string | undefined>): GitHubRequest {
  return async (method, path, body) => {
    const dir = await mkdtemp(join(tmpdir(), 'gm-qa-github-'));
    try {
      const args = ['api', '--method', method, path];
      if (body !== undefined) {
        const file = join(dir, 'request.json');
        await writeFile(file, JSON.stringify(body), { mode: 0o600 });
        args.push('--input', file);
      }
      const result = await promisify(execFile)('gh', args, {
        ...(env ? { env: { ...env, GH_PROMPT_DISABLED: '1' } } : {}),
        timeout: 120_000,
        maxBuffer: 8_000_000,
      });
      return result.stdout ? (JSON.parse(result.stdout) as unknown) : {};
    } catch (error) {
      // GitHub errors can include issue contents or auth details; the result must not print them.
      const stderr = (error as { stderr?: unknown })?.stderr;
      const match = typeof stderr === 'string' ? /\bHTTP (\d{3})\b/u.exec(stderr) : null;
      throw new QaGitHubError(match ? Number(match[1]) : undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
