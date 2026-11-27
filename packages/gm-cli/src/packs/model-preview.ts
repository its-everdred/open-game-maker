import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromiumGuard } from './chromium-guard.js';
import { killPreviewDescendants, previewDescendants } from './preview-process-tree.js';

/** Run each preview in its own process group so a wedged browser can be killed. */
export async function modelPreview(
  source: string,
  out: string,
  assetsRoot: string,
  software: boolean,
  expectedHash: string,
  cached: boolean,
  timeoutMs = 120_000,
): Promise<string> {
  const worker = fileURLToPath(new URL('./model-preview-worker.js', import.meta.url));
  return runPreviewWorker(worker, [source, out, assetsRoot, String(software), expectedHash, String(cached)], timeoutMs);
}

export class ModelSourceMismatch extends Error {}

export async function runPreviewWorker(worker: string, args: string[], timeoutMs: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ogm-preview-worker-guard-'));
  try {
    if (process.platform !== 'linux')
      return await runWorker(process.execPath, worker, [...args, directory], timeoutMs, directory);
    const guard = join(directory, 'node-guard');
    await writeFile(guard, chromiumGuard(process.pid, process.execPath), { mode: 0o700 });
    return await runWorker(guard, worker, [...args, directory], timeoutMs, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runWorker(
  command: string,
  worker: string,
  args: string[],
  timeoutMs: number,
  runtime: string,
): Promise<string> {
  const child = spawn(command, [worker, ...args], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { HOME: runtime, TMPDIR: runtime, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout = (stdout + chunk).slice(-4096);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4096);
  });
  let timedOut = false;
  let escalation: NodeJS.Timeout | undefined;
  let closed = false;
  let escalationError: unknown;
  const descendants = new Map<string, ReturnType<typeof previewDescendants>[number]>();
  const rememberDescendants = (): void => {
    try {
      for (const entry of child.pid ? previewDescendants(child.pid) : []) {
        descendants.set(`${entry.pid}:${entry.start}`, entry);
      }
    } catch (error) {
      escalationError ??= error;
    }
  };
  const monitor = setInterval(rememberDescendants, 500);
  monitor.unref();
  let finishEscalation: () => void = () => undefined;
  const escalated = new Promise<void>((resolve) => {
    finishEscalation = resolve;
  });
  const signal = (value: NodeJS.Signals): void => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, value);
      else child.kill(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    rememberDescendants();
    // Give Playwright's signal handler a chance to stop its detached Chromium process.
    try {
      signal('SIGTERM');
    } catch (error) {
      escalationError ??= error;
    }
    escalation = setTimeout(() => {
      try {
        killPreviewDescendants([...descendants.values()]);
      } catch (error) {
        escalationError ??= error;
      } finally {
        try {
          if (!closed) signal('SIGKILL');
        } catch (error) {
          escalationError ??= error;
        }
        finishEscalation();
      }
    }, 1_000);
  }, timeoutMs);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    closed = true;
    if (timedOut) await escalated;
    if (timedOut) {
      if (escalationError) throw new Error(`preview timed out; cleanup failed: ${String(escalationError)}`);
      throw new Error(`preview timed out after ${timeoutMs}ms`);
    }
    if (code === 3) throw new ModelSourceMismatch('source hash does not match card');
    if (code !== 0) {
      try {
        killPreviewDescendants([...descendants.values()]);
      } catch (error) {
        escalationError ??= error;
      }
      const cleanup = escalationError ? `; cleanup failed: ${String(escalationError)}` : '';
      throw new Error(`preview worker exited ${code}${cleanup}: ${stderr.trim().slice(-500)}`);
    }
    const result: unknown = JSON.parse(stdout);
    if (!result || typeof result !== 'object' || !('renderer' in result) || typeof result.renderer !== 'string') {
      throw new Error('preview worker returned an invalid result');
    }
    return result.renderer;
  } finally {
    clearTimeout(timer);
    clearInterval(monitor);
    if (escalation && !timedOut) clearTimeout(escalation);
  }
}
