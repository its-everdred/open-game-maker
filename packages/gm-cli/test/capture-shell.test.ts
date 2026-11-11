import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gm, tempDir } from './helpers.js';

describe('gm capture shell', () => {
  it('runs the web build and capture with local paths and releases the capture slot', async () => {
    const root = tempDir();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const log = join(root, 'calls');
    const pnpm = join(bin, 'pnpm');
    writeFileSync(pnpm, '#!/bin/sh\nprintf "%s\\n" "$*|$GM_SHELL_DIST|$GM_SHELL_TAPS" >> "$LOG"\n');
    chmodSync(pnpm, 0o755);
    const result = await gm(['capture', 'shell', '--web', '.', '--dist', 'dist', '--out', 'shots', '--tap', 'Play'], {
      cwd: root,
      env: { PATH: `${bin}:${process.env.PATH}`, LOG: log, XDG_RUNTIME_DIR: root },
    });
    expect(result.code).toBe(0);
    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain(`vite build`);
    expect(calls).toContain(`playwright test --config e2e/shell-capture.config.ts|${join(root, 'dist')}|["Play"]`);
  });

  it('stops a stuck build at the requested timeout', async () => {
    const root = tempDir();
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
});
