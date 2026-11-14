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
