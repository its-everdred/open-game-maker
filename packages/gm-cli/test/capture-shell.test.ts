import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireSlot } from '@ogm/gm-verify';
import { describe, expect, it } from 'vitest';
import { runChild } from '../src/commands/capture/shell.js';
import { gm, tempDir } from './helpers.js';

describe('gm capture shell', () => {
  function fixture(root: string) {
    mkdirSync(join(root, 'dist', 'design'), { recursive: true });
    writeFileSync(join(root, 'dist', 'index.html'), 'game');
    writeFileSync(join(root, 'dist', 'design', 'design.json'), '{}');
  }
  it('runs the web build and capture with local paths and releases the capture slot', async () => {
    const root = tempDir();
    fixture(root);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const log = join(root, 'calls');
    const pnpm = join(bin, 'pnpm');
    mkdirSync(join(root, 'shots'));
    writeFileSync(join(root, 'shots', 'ingame-390x844.png'), 'stale');
    writeFileSync(pnpm, '#!/bin/sh\nprintf "%s\\n" "$*|$GM_SHELL_DIST|$GM_SHELL_TAPS" >> "$LOG"\n');
    chmodSync(pnpm, 0o755);
    const result = await gm(['capture', 'shell', '--web', '.', '--dist', 'dist', '--out', 'shots', '--tap', 'Play'], {
      cwd: root,
      env: { PATH: `${bin}:${process.env.PATH}`, LOG: log, XDG_RUNTIME_DIR: root },
    });
    expect(result.code).toBe(0);
    expect(existsSync(join(root, 'shots', 'ingame-390x844.png'))).toBe(false);
    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain(`vite build`);
    expect(calls).toContain(`playwright test --config e2e/shell-capture.config.ts|${join(root, 'dist')}|["Play"]`);
  });

  it('stops a stuck build at the requested timeout', async () => {
    const root = tempDir();
    fixture(root);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const pnpm = join(bin, 'pnpm');
    writeFileSync(pnpm, '#!/bin/sh\nsleep 20\n');
    chmodSync(pnpm, 0o755);
    const result = await gm(['capture', 'shell', '--web', '.', '--dist', 'dist', '--out', 'shots', '--timeout', '1'], {
      cwd: root,
      env: { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: root },
    });
    expect(result.code).toBe(3);
  });

  it('rejects a build with no game entry', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'dist', 'design'), { recursive: true });
    writeFileSync(join(root, 'dist', 'design', 'design.json'), '{}');
    const result = await gm(['capture', 'shell', '--web', '.', '--dist', 'dist', '--out', 'shots'], { cwd: root });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('missing index.html');
  });

  it('releases the slot when Playwright fails', async () => {
    const root = tempDir();
    fixture(root);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const pnpm = join(bin, 'pnpm');
    writeFileSync(pnpm, '#!/bin/sh\nif [ "$2" = playwright ]; then exit 5; fi\n');
    chmodSync(pnpm, 0o755);
    const result = await gm(['capture', 'shell', '--web', '.', '--dist', 'dist', '--out', 'shots'], {
      cwd: root,
      env: { PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: root },
    });
    expect(result.code).toBe(5);
    const first = await acquireSlot({ runtimeDir: root, waitMs: 1000 });
    const second = await acquireSlot({ runtimeDir: root, waitMs: 1000 });
    first.release();
    second.release();
  });

  it('terminates an interrupted child process group', async () => {
    const root = tempDir();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const pnpm = join(bin, 'pnpm');
    writeFileSync(pnpm, '#!/bin/sh\nsleep 20\n');
    chmodSync(pnpm, 0o755);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 200);
    try {
      const result = await runChild(root, [], { PATH: `${bin}:${process.env.PATH}` }, 10_000, abort.signal);
      expect(result).toBe(130);
    } finally {
      clearTimeout(timer);
    }
  });
});
