import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { buildLiveSnapshot } from '../src/live-build.js';

const root = mkdtempSync(join(tmpdir(), 'gm-live-build-'));
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('keeps the last completed build available when the next build fails', async () => {
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const pnpm = join(bin, 'pnpm');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }));
  const successfulBuild =
    '#!/bin/sh\nmkdir -p "$4/design"\ncp source "$4/index.html"\nprintf \'{"schemaVersion":1,"globals":{},"entities":{}}\' > "$4/design/design.json"\n';
  writeFileSync(pnpm, successfulBuild);
  chmodSync(pnpm, 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` };
  writeFileSync(join(root, 'source'), 'first');
  await buildLiveSnapshot(root, env);
  const current = join(root, '.gm/live/current/index.html');
  const firstVersion = join(root, '.gm/live', readlinkSync(join(root, '.gm/live/current')));
  expect(readFileSync(current, 'utf8')).toBe('first');
  writeFileSync(join(root, 'source'), 'second');
  writeFileSync(pnpm, '#!/bin/sh\nmkdir -p "$4"\necho partial > "$4/index.html"\nexit 1\n');
  await expect(buildLiveSnapshot(root, env)).rejects.toThrow('build failed');
  expect(readFileSync(current, 'utf8')).toBe('first');
  writeFileSync(pnpm, '#!/bin/sh\nmkdir -p "$4"\ncp source "$4/index.html"\n');
  await expect(buildLiveSnapshot(root, env)).rejects.toThrow('missing or invalid design');
  expect(readFileSync(current, 'utf8')).toBe('first');
  writeFileSync(pnpm, successfulBuild);
  await buildLiveSnapshot(root, env);
  expect(readFileSync(current, 'utf8')).toBe('second');
  expect(existsSync(firstVersion)).toBe(true);
  writeFileSync(pnpm, '#!/bin/sh\nmkdir -p "$4"\ncp source "$4/index.html"\nln -s /etc/passwd "$4/link"\n');
  await expect(buildLiveSnapshot(root, env)).rejects.toThrow('symbolic links');
  expect(readFileSync(current, 'utf8')).toBe('second');
  writeFileSync(pnpm, '#!/bin/sh\nmkdir -p "$4"\necho \'<script src="/assets/game.js">\' > "$4/index.html"\n');
  await expect(buildLiveSnapshot(root, env)).rejects.toThrow('origin root');
  expect(readFileSync(current, 'utf8')).toBe('second');
  const expired = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(firstVersion, expired, expired);
  writeFileSync(pnpm, successfulBuild);
  await buildLiveSnapshot(root, env);
  expect(existsSync(firstVersion)).toBe(false);
});
