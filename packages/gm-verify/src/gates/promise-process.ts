import { spawn } from 'node:child_process';

export type SpawnResult = { status: number | null; stdout: string; stderr: string; error?: Error };
export type SpawnOptions = { cwd: string; encoding: 'utf8'; timeout: number; signal?: AbortSignal };

/** Run Vitest without blocking watchdog timers, and kill its process group on cancellation. */
export function runPromiseProcess(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const finish = (result: SpawnResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      resolve(result);
    };
    const cancel = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
      finish({ status: null, stdout, stderr, error: new Error('promise specs timed out or cancelled') });
    };
    const timer = setTimeout(cancel, options.timeout);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.stdout.setEncoding('utf8').on('data', (data: string) => {
      stdout += data;
    });
    child.stderr.setEncoding('utf8').on('data', (data: string) => {
      stderr += data;
    });
    child.once('error', (error) => finish({ status: null, stdout, stderr, error }));
    child.once('close', (status) => finish({ status, stdout, stderr }));
  });
}
