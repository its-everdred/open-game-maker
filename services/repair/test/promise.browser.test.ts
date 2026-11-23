import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPromiseSpecs } from '@ogm/gm-verify';
import { afterAll, describe, expect, it } from 'vitest';

import { promiseArtifact } from '../src/promise-gen.js';

const STUB = fileURLToPath(new URL('../../../packages/gm-verify/fixtures/stub-game/', import.meta.url));
const CRASH_LINE = /^.*if \(f\.actions\.crash\) throw .*$/m;
const SIGNATURE = 'e'.repeat(64);
const software = process.env.GM_VERIFY_SOFTWARE_GL === '1';

// The game root sits inside this package so the spawned Vitest resolves `@gm/sdk/test` like a game repo does.
const root = mkdtempSync(join(fileURLToPath(new URL('..', import.meta.url)), '.promise-game-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('generated promise spec against the stub game', () => {
  // The promise only protects a creator if it fails on the reported build and passes once the bug is fixed.
  it('fails on the crashing build and passes after the crash is fixed', async () => {
    const artifact = promiseArtifact(SIGNATURE, {
      seed: 7,
      keyframe: { tick: 0, state: { t: 0, lastAction: null, alive: true } },
      actions: [{ tick: 11, action: 'crash', phase: 'down' }],
      errors: [{ message: "TypeError: Cannot read properties of undefined (reading 'speed')" }],
      probes: {},
    });
    mkdirSync(join(root, 'promises'));
    writeFileSync(join(root, artifact.specPath), artifact.spec);
    writeFileSync(join(root, artifact.replayPath), artifact.replay);
    cpSync(STUB, join(root, 'dist'), { recursive: true });

    const red = await runPromiseSpecs(root, { software });
    expect(red).toMatchObject({
      id: 'promises',
      ok: false,
      file: artifact.specPath,
      detail: expect.stringContaining('1 failed'),
    });

    // Vitest leaves a cache under node_modules; pnpm then refuses this package-less root (real games have one).
    rmSync(join(root, 'node_modules'), { recursive: true, force: true });
    const page = join(root, 'dist', 'stub.js');
    const html = readFileSync(page, 'utf8');
    expect(html).toMatch(CRASH_LINE);
    writeFileSync(page, html.replace(CRASH_LINE, ''));

    await expect(runPromiseSpecs(root, { software })).resolves.toEqual({
      id: 'promises',
      ok: true,
      detail: '1 promise spec(s)',
    });
  });
});
