import { spawn } from 'node:child_process';
import { link, mkdtemp, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PlannedUnityMesh } from './plan.js';

const worker = fileURLToPath(new URL('../../../../../scripts/assets/blender_unity_assembly.py', import.meta.url));

async function runBlender(args: string[], signal: AbortSignal, env?: NodeJS.ProcessEnv): Promise<void> {
  if (signal.aborted) throw new Error('Unity exporter cancelled');
  const child = spawn('blender', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  let size = 0;
  let failure: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 5000);
  };
  const collect = (chunk: Buffer) => {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) {
      failure ??= new Error('Unity exporter output exceeded its limit');
      stop();
    } else chunks.push(chunk);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', (error) => {
    failure ??= error;
  });
  signal.addEventListener('abort', stop, { once: true });
  try {
    const [code, exitSignal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
      child.once('close', (code, signal) => resolve([code, signal]));
    });
    if (failure) throw failure;
    if (signal.aborted) throw new Error('Unity exporter cancelled');
    if (code !== 0)
      throw new Error(`Unity exporter failed (${exitSignal ?? code}): ${Buffer.concat(chunks).toString('utf8')}`);
  } finally {
    signal.removeEventListener('abort', stop);
    if (killTimer) clearTimeout(killTimer);
  }
}

/** Export into a private staging directory and publish without replacing an existing file. */
export async function exportUnityAssembly(
  plan: PlannedUnityMesh[],
  output: string,
  environment?: NodeJS.ProcessEnv,
): Promise<void> {
  if (!output.toLowerCase().endsWith('.glb')) throw new Error('Unity assembly output must be a .glb');
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  let directory: string | undefined;
  let published = false;
  try {
    directory = await mkdtemp(join(dirname(output), '.unity-assembly-'));
    if (abort.signal.aborted) throw new Error('Unity exporter cancelled');
    const planFile = join(directory, 'plan.json');
    const resultFile = join(directory, basename(output));
    await writeFile(planFile, JSON.stringify(plan), { mode: 0o600, flag: 'wx' });
    await runBlender(
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
      abort.signal,
      environment,
    );
    if (!(await stat(resultFile)).size) throw new Error('Unity exporter wrote an empty GLB');
    if (abort.signal.aborted) throw new Error('Unity exporter cancelled');
    await link(resultFile, output);
    published = true;
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      try {
        if (abort.signal.aborted && published) await unlink(output);
      } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
    }
  }
  if (abort.signal.aborted) throw new Error('Unity exporter cancelled');
}
