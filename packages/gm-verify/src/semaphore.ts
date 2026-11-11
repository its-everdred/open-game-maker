import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const HOST_SLOTS = 2;
export const SLOT_WAIT_MS = 10 * 60_000;

export type SemaphoreOptions = {
  runtimeDir?: string;
  slots?: number;
  waitMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
};

/** `$XDG_RUNTIME_DIR/ogm-verify`, else a per-user directory under the temp dir. */
export function lockRoot(runtimeDir: string | undefined): string {
  return runtimeDir ? join(runtimeDir, 'ogm-verify') : join(tmpdir(), `ogm-verify-${userInfo().uid}`);
}

// The child keeps the kernel lock until its stdin closes, including when the parent dies.
// Lock files are never unlinked: removing a locked inode would allow a second holder.
function tryTake(slot: string, signal?: AbortSignal): Promise<ChildProcessWithoutNullStreams | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn('flock', ['-n', '-E', '75', `${slot}.lock`, 'sh', '-c', 'printf "locked\\n"; cat >/dev/null']);
    let settled = false;
    const abort = () => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('capture slot acquisition cancelled'));
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('close', () => signal?.removeEventListener('abort', abort));
    if (signal?.aborted) abort();
    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.stdout.once('data', () => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener('abort', abort);
        resolve(child);
      }
    });
    child.once('exit', (code) => {
      if (!settled) {
        settled = true;
        if (code === 75) resolve(undefined);
        else reject(new Error(`capture lock helper exited with code ${code}`));
      }
    });
  });
}

/** A host-wide counting semaphore backed by kernel locks. */
export async function acquireSlot(options: SemaphoreOptions = {}): Promise<{ slot: string; release(): void }> {
  let root = lockRoot(options.runtimeDir);
  const slots = options.slots ?? HOST_SLOTS;
  const deadline = Date.now() + (options.waitMs ?? SLOT_WAIT_MS);
  try {
    mkdirSync(root, { recursive: true });
  } catch {
    if (options.runtimeDir === undefined) throw new Error(`cannot create capture lock root ${root}`);
    root = lockRoot(undefined);
    mkdirSync(root, { recursive: true });
  }
  let pause = options.pollMs ?? 100;
  for (;;) {
    for (let i = 0; i < slots; i += 1) {
      const slot = join(root, `slot-${i}`);
      if (options.signal?.aborted) throw new Error('capture slot acquisition cancelled');
      const holder = await tryTake(slot, options.signal);
      if (holder) {
        let held = true;
        return {
          slot,
          release() {
            if (!held) return;
            held = false;
            holder.stdin.end();
          },
        };
      }
    }
    if (Date.now() >= deadline) throw new Error(`no free capture slot after ${options.waitMs ?? SLOT_WAIT_MS} ms`);
    await sleep(pause, undefined, { signal: options.signal });
    pause = Math.min(pause * 2, 2_000);
  }
}
