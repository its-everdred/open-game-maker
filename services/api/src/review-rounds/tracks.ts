import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ReviewTrack } from '@ogm/contracts';

const exec = promisify(execFile);

// Read the committed definition for the submitted SHA, not a mutable checkout file.
export async function readTrack(checkout: string, gamePath: string, sha: string, track: string): Promise<ReviewTrack> {
  if (
    !/^[a-f0-9]{40}$/u.test(sha) ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(track) ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(gamePath)
  )
    throw new Error('invalid_track_reference');
  const path = `${gamePath}/review/tracks/${track}.json`;
  const result = await exec('git', ['-C', checkout, 'show', `${sha}:${path}`], { timeout: 15000, maxBuffer: 65536 });
  const definition = ReviewTrack.parse(JSON.parse(result.stdout) as unknown);
  if (definition.id !== track) throw new Error('track_id_mismatch');
  return definition;
}

export async function listTracks(checkout: string, gamePath: string, revision = 'HEAD'): Promise<ReviewTrack[]> {
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(gamePath)) throw new Error('invalid_track_reference');
  if (revision !== 'HEAD' && !/^[a-f0-9]{40}$/u.test(revision)) throw new Error('invalid_track_reference');
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
