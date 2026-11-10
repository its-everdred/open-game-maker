import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { acquireSlot } from '../src/semaphore.js';

const runtime = () => mkdtempSync(join(tmpdir(), 'gm-sem-'));

describe('acquireSlot', () => {
  it('lets two captures run and makes the third wait until one releases', async () => {
    const runtimeDir = runtime();
    const a = await acquireSlot({ runtimeDir, pollMs: 10 });
    const b = await acquireSlot({ runtimeDir, pollMs: 10 });
    let third = false;
    const c = acquireSlot({ runtimeDir, pollMs: 10 }).then((slot) => {
      third = true;
      return slot;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(third).toBe(false);
    a.release();
    const slot = await c;
    expect(third).toBe(true);
    expect(slot.slot).toBe(a.slot);
    b.release();
    slot.release();
  });

  it('gives up after waitMs', async () => {
    const runtimeDir = runtime();
    const held = await acquireSlot({ runtimeDir, slots: 1 });
    await expect(acquireSlot({ runtimeDir, slots: 1, waitMs: 50, pollMs: 10 })).rejects.toThrow(/no free capture slot/);
    held.release();
  });

  it('ignores a legacy slot with a foreign PID that is alive locally', async () => {
    const runtimeDir = runtime();
    const slot = join(runtimeDir, 'ogm-verify', 'slot-0');
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, 'pid'), String(process.pid));
    const got = await acquireSlot({ runtimeDir, slots: 1, waitMs: 1_000 });
    expect(got.slot).toBe(slot);
    got.release();
  });

  it('releases the kernel lock when a holder process dies', async () => {
    const runtimeDir = runtime();
    const moduleUrl = new URL('../dist/semaphore.js', import.meta.url).href;
    const script = `import { acquireSlot } from ${JSON.stringify(moduleUrl)};
      await acquireSlot({ runtimeDir: ${JSON.stringify(runtimeDir)}, slots: 1 });
      console.log('ready'); setInterval(() => {}, 1000);`;
    const holder = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await once(holder.stdout, 'data');
      await expect(acquireSlot({ runtimeDir, slots: 1, waitMs: 50, pollMs: 10 })).rejects.toThrow(/no free capture slot/);
      holder.kill('SIGKILL');
      await once(holder, 'exit');
      // Simulate a stale namespace-local PID that happens to be alive here.
      const legacySlot = join(runtimeDir, 'ogm-verify', 'slot-0');
      mkdirSync(legacySlot, { recursive: true });
      writeFileSync(join(legacySlot, 'pid'), String(process.pid));
      const next = await acquireSlot({ runtimeDir, slots: 1, waitMs: 2_000, pollMs: 10 });
      next.release();
    } finally {
      holder.kill('SIGKILL');
    }
  });

  it('reports lock helper failures instead of treating them as contention', async () => {
    const bin = runtime();
    const fakeFlock = join(bin, 'flock');
    writeFileSync(fakeFlock, '#!/bin/sh\nexit 1\n');
    chmodSync(fakeFlock, 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ''}`;
    try {
      await expect(acquireSlot({ runtimeDir: runtime(), slots: 1, waitMs: 100, pollMs: 10 }))
        .rejects.toThrow(/capture lock helper exited with code 1/);
    } finally {
      if (path === undefined) delete process.env.PATH;
      else process.env.PATH = path;
    }
  });

  it('falls back to the per-user temp root when XDG_RUNTIME_DIR is unusable', async () => {
    const invalid = join(runtime(), 'not-a-directory');
    writeFileSync(invalid, 'x');
    const got = await acquireSlot({ runtimeDir: invalid, slots: 20, waitMs: 1_000, pollMs: 10 });
    expect(got.slot).toMatch(/ogm-verify-\d+\/slot-\d+$/);
    got.release();
  });
});
