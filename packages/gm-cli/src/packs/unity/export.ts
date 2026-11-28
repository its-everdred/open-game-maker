import { execFile } from 'node:child_process';
import { link, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import type { PlannedUnityMesh } from './plan.js';

const exec = promisify(execFile);
const worker = fileURLToPath(new URL('../../../../../scripts/assets/blender_unity_assembly.py', import.meta.url));

/** Export into a private staging directory and publish without replacing an existing file. */
export async function exportUnityAssembly(
  plan: PlannedUnityMesh[],
  output: string,
  environment?: NodeJS.ProcessEnv,
): Promise<void> {
  if (!output.toLowerCase().endsWith('.glb')) throw new Error('Unity assembly output must be a .glb');
  const directory = await mkdtemp(join(dirname(output), '.unity-assembly-'));
  try {
    const planFile = join(directory, 'plan.json');
    const resultFile = join(directory, basename(output));
    await writeFile(planFile, JSON.stringify(plan), { mode: 0o600, flag: 'wx' });
    await exec(
      'blender',
      [
        '--background',
        '--quiet',
        '--factory-startup',
        '--python-use-system-env',
        '--python-exit-code',
        '1',
        '--python',
        worker,
        '--',
        planFile,
        resultFile,
      ],
      // Full buildings may need many serialized mesh bakes. Do not kill an
      // active conversion based on a fixed wall-clock limit.
      { env: environment, maxBuffer: 64 * 1024 * 1024 },
    );
    if (!(await stat(resultFile)).size) throw new Error('Unity exporter wrote an empty GLB');
    await link(resultFile, output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
