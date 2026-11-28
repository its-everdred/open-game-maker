import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ spawn: vi.fn(), beforeStat: undefined as undefined | (() => Promise<void>) }));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: state.spawn,
  execFile: (_command: unknown, _args: unknown, _options: unknown, callback: (error: Error) => void) =>
    callback(new Error('old exporter has no cancellation')),
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      if (state.beforeStat) await state.beforeStat();
      return actual.stat(...args);
    },
  };
});

import { exportUnityAssembly } from '../src/packs/unity/export.js';

it('waits for a cancelled Blender child before removing staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-unity-cancel-'));
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  state.spawn.mockReturnValue(child);
  const before = process.listeners('SIGTERM');
  try {
    const run = exportUnityAssembly([], join(root, 'result.glb'));
    const result = run.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(state.spawn).toHaveBeenCalled());
    const listener = process.listeners('SIGTERM').find((item) => !before.includes(item));
    expect(listener).toBeDefined();
    vi.useFakeTimers();
    listener!();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect((await readdir(root)).some((name) => name.startsWith('.unity-assembly-'))).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null, 'SIGTERM');
    vi.useRealTimers();
    expect(await result).toMatchObject({ message: 'Unity exporter cancelled' });
    expect(await readdir(root)).toEqual([]);
    expect(process.listeners('SIGTERM')).toEqual(before);
  } finally {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
    state.spawn.mockReset();
  }
});

it('does not publish when cancelled after Blender exits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gm-unity-cancel-publish-'));
  const before = process.listeners('SIGTERM');
  let release!: () => void;
  let entered!: () => void;
  const enteredStat = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.beforeStat = async () => {
    entered();
    await blocked;
  };
  state.spawn.mockImplementation((_command, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    void writeFile(args.at(-1)!, 'glb').then(() => child.emit('close', 0, null));
    return child;
  });
  try {
    const run = exportUnityAssembly([], join(root, 'result.glb'));
    const result = run.then(
      () => undefined,
      (error: unknown) => error,
    );
    await enteredStat;
    const listener = process.listeners('SIGTERM').find((item) => !before.includes(item));
    expect(listener).toBeDefined();
    listener!();
    release();
    expect(await result).toMatchObject({ message: 'Unity exporter cancelled' });
    expect(await readdir(root)).toEqual([]);
  } finally {
    release();
    state.beforeStat = undefined;
    state.spawn.mockReset();
    await rm(root, { recursive: true, force: true });
  }
});
