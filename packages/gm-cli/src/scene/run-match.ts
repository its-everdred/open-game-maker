import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promisify } from 'node:util';
import { parseSceneBatchMatch } from './parse-worker-result.js';

const execute = promisify(execFile);
const MAX_MOCK_BYTES = 64 * 1024 * 1024;
type Crop = readonly [number, number, number, number];

async function mockHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const data = chunk as Buffer;
    bytes += data.length;
    if (bytes > MAX_MOCK_BYTES) throw new Error('mock exceeds file size limit');
    hash.update(data);
  }
  return hash.digest('hex');
}

/** Run the local, rights-checking matcher; the caller must validate mock rights. */
export async function runSceneMatch(input: {
  python: string;
  worker: string;
  assetsRoot: string;
  pack: string;
  mock: string;
  crops: readonly Crop[];
  facing: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  encoder: 'clip' | 'siglip';
  limit?: number;
}) {
  if (
    !input.crops.length ||
    input.crops.length > 32 ||
    input.crops.some(
      (crop) =>
        crop.length !== 4 || crop.some((value, index) => !Number.isSafeInteger(value) || value < (index < 2 ? 0 : 1)),
    )
  )
    throw new Error('invalid scene match crops');
  const limit = input.limit ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('invalid scene match limit');
  const args = ['-I', input.worker, '--assets-root', input.assetsRoot, '--pack', input.pack, '--mock', input.mock];
  for (const crop of input.crops) args.push('--crop', crop.join(','));
  args.push('--facing', input.facing, '--encoder', input.encoder, '--limit', String(limit), '--include-vectors');
  const { stdout } = await execute(input.python, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const result = parseSceneBatchMatch(JSON.parse(stdout) as unknown);
  if (result.mock_sha256 !== (await mockHash(input.mock)))
    throw new Error('scene match was computed from a different mock');
  if (
    result.regions.length !== input.crops.length ||
    result.regions.some((region, i) => region.crop.some((value, j) => value !== input.crops[i]![j]))
  )
    throw new Error('scene matcher returned different crops');
  return result;
}
