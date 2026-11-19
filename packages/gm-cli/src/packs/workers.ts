import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { availableParallelism, homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type WorkerRecord = Record<string, unknown> & {
  card?: string;
  status?: string;
  flags?: unknown[];
};

export type WorkerEnvironmentOptions = {
  assetsRoot: string;
  eventsFile?: string;
  workers: number;
  home?: string;
};

export function effectiveWorkers(requested: number, logicalCores = availableParallelism()): number {
  const ceiling = Math.max(1, Math.floor(logicalCores / 3));
  return requested > 0 ? Math.max(1, Math.min(requested, ceiling)) : ceiling;
}

export function workerEnvironment(options: WorkerEnvironmentOptions): Record<string, string> {
  // The analysis stages launch a process pool, so each process gets one thread.
  const threads = '1';
  return {
    PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: options.home ?? homedir(),
    OGM_ASSETS_ROOT: options.assetsRoot,
    ...(options.eventsFile ? { GM_EVENTS_FILE: options.eventsFile } : {}),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    TOKENIZERS_PARALLELISM: 'false',
    OGM_TORCH_THREADS: threads,
    OMP_NUM_THREADS: threads,
    MKL_NUM_THREADS: threads,
    OPENBLAS_NUM_THREADS: threads,
    NUMEXPR_NUM_THREADS: threads,
  };
}

export async function resolvePython(repo: string): Promise<string> {
  const primary = join(repo, 'scripts/py/audio/.venv/bin/python');
  const legacy = join(repo, 'scripts/audio/.venv/bin/python');
  try {
    await access(primary, constants.X_OK);
    return primary;
  } catch {
    try {
      await access(legacy, constants.X_OK);
      return legacy;
    } catch {
      return primary;
    }
  }
}

export class WorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerError';
  }
}

export type RunJsonWorkerOptions = {
  label: string;
  program: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  onRecord(record: WorkerRecord): void;
  maxLineBytes?: number;
  maxStderrBytes?: number;
};

export type WorkerResult = {
  stderr: string;
  stderrTruncated: boolean;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runJsonWorker(options: RunJsonWorkerOptions): Promise<WorkerResult> {
  const maxLineBytes = options.maxLineBytes ?? 64 * 1024;
  const maxStderrBytes = options.maxStderrBytes ?? 64 * 1024;
  await access(options.program, constants.X_OK).catch(() => {
    throw new WorkerError(`${options.label}: local Python environment is missing: ${options.program}`);
  });
  const child = spawn('nice', ['-n', '10', options.program, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.setEncoding('utf8');
  let stdout = '';
  let failure: Error | null = null;
  let killTimer: NodeJS.Timeout | undefined;
  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  let stderrTruncated = false;

  const terminate = (error: unknown): void => {
    if (failure) return;
    failure = asError(error);
    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => signalGroup('SIGKILL'), 1_000);
    killTimer.unref();
  };

  const consume = (line: string): void => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > maxLineBytes) {
      terminate(new WorkerError(`${options.label} emitted a line larger than ${maxLineBytes} bytes`));
      return;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('record is not an object');
      }
      options.onRecord(parsed as WorkerRecord);
    } catch (error) {
      terminate(new WorkerError(`${options.label} emitted malformed JSON: ${asError(error).message}`));
    }
  };

  child.stdout.on('data', (chunk: string) => {
    if (failure) return;
    stdout += chunk;
    let newline = stdout.indexOf('\n');
    while (newline >= 0) {
      consume(stdout.slice(0, newline).replace(/\r$/, ''));
      stdout = stdout.slice(newline + 1);
      if (failure) return;
      newline = stdout.indexOf('\n');
    }
    if (Buffer.byteLength(stdout) > maxLineBytes) {
      terminate(new WorkerError(`${options.label} emitted an unterminated line larger than ${maxLineBytes} bytes`));
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const remaining = maxStderrBytes - stderrBytes;
    if (remaining <= 0) {
      stderrTruncated = true;
      return;
    }
    const kept = chunk.subarray(0, remaining);
    stderr.push(kept);
    stderrBytes += kept.length;
    if (kept.length < chunk.length) stderrTruncated = true;
  });

  const completed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  }).catch((error) => {
    throw new WorkerError(`${options.label} could not start: ${asError(error).message}`);
  });
  if (killTimer) clearTimeout(killTimer);
  if (!failure && stdout.trim()) consume(stdout.replace(/\r$/, ''));
  const diagnostics = Buffer.concat(stderr).toString('utf8');
  if (failure) throw failure;
  if (completed.code !== 0) {
    const detail = diagnostics.trim().slice(-2_000);
    throw new WorkerError(
      `${options.label} exited ${completed.code ?? `on ${completed.signal ?? 'unknown signal'}`}${detail ? `: ${detail}` : ''}`,
    );
  }
  return { stderr: diagnostics, stderrTruncated };
}
