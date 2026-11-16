import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';

import { ReviewTrack } from '@ogm/contracts';
import { ensureCommit } from '../operator/ensure-commit.js';

const exec = promisify(execFile);

// Registered shared daemons may point directly at a checkout; fleet daemons store ticket checkouts under workspaces/.
export async function reviewCheckout(root: string, ticket: string, repo: string): Promise<string> {
  if (!/^[1-9]\d{0,15}$/u.test(ticket)) throw new Error('invalid_ticket');
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo) ||
    repo.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('invalid_repo');
  try {
    const top = (await exec('git', ['-C', root, 'rev-parse', '--show-toplevel'], { timeout: 15000 })).stdout.trim();
    if ((await realpath(top)) === (await realpath(root))) return root;
  } catch {
    /* fleet directories are not Git checkouts */
  }
  const path = join(root, 'workspaces', ...repo.split('/'), ticket);
  const top = (await exec('git', ['-C', path, 'rev-parse', '--show-toplevel'], { timeout: 15000 })).stdout.trim();
  if ((await realpath(top)) !== (await realpath(path))) throw new Error('review_checkout_invalid');
  return path;
}

// Read the committed definition for the submitted SHA, not a mutable checkout file.
export async function readTrack(checkout: string, gamePath: string, sha: string, track: string): Promise<ReviewTrack> {
  if (
    !/^[a-f0-9]{40}$/u.test(sha) ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(track) ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(gamePath)
  )
    throw new Error('invalid_track_reference');
  const path = `${gamePath}/review/tracks/${track}.json`;
  await ensureCommit(checkout, sha);
  const result = await exec('git', ['-C', checkout, 'show', `${sha}:${path}`], { timeout: 15000, maxBuffer: 65536 });
  const definition = ReviewTrack.parse(JSON.parse(result.stdout) as unknown);
  if (definition.id !== track) throw new Error('track_id_mismatch');
  return definition;
}

export async function listTracks(checkout: string, gamePath: string, revision = 'HEAD'): Promise<ReviewTrack[]> {
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(gamePath)) throw new Error('invalid_track_reference');
  if (revision !== 'HEAD' && !/^[a-f0-9]{40}$/u.test(revision)) throw new Error('invalid_track_reference');
  if (revision !== 'HEAD') await ensureCommit(checkout, revision);
  const head = (
    await exec('git', ['-C', checkout, 'rev-parse', '--verify', `${revision}^{commit}`], { timeout: 15000 })
  ).stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error('invalid_track_reference');
  const directory = `${gamePath}/review/tracks/`;
  const names = (
    await exec('git', ['-C', checkout, 'ls-tree', '-r', '--name-only', head, '--', directory], {
      timeout: 15000,
      maxBuffer: 65536,
    })
  ).stdout
    .split('\n')
    .filter((name) => name.endsWith('.json'));
  return Promise.all(
    names.map((name) => {
      const match = new RegExp(
        `^${directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([a-z0-9][a-z0-9_-]{0,63})\\.json$`,
        'u',
      ).exec(name);
      if (!match) throw new Error('invalid_track_reference');
      return readTrack(checkout, gamePath, head, match[1]!);
    }),
  );
}
