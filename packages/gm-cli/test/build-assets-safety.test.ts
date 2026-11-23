import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCached } from '../src/commands/build/assets/cache.js';
import { gm, tempDir } from './helpers.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeImageLock(cwd: string, path = 'assets/image.png', digest = sha256(ONE_PIXEL_PNG)): void {
  writeFileSync(
    join(cwd, 'assets.lock.json'),
    `${JSON.stringify(
      {
        version: 1,
        family: 'chunky-low-poly',
        pov: 'iso',
        assets: [
          {
            id: 't3:fixture/image',
            sha256: digest,
            path,
            license: 'CC0-1.0',
            rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: null },
            credit: {
              pack: 'fixture',
              title: 'Fixture assets',
              licenseSource: 'Fixture CC0 declaration',
              attribution: 'none required',
              source: { label: 'test fixture' },
            },
            added: '2026-11-01',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function writeImage(cwd: string): void {
  mkdirSync(join(cwd, 'assets'), { recursive: true });
  writeFileSync(join(cwd, 'assets/image.png'), ONE_PIXEL_PNG);
  writeImageLock(cwd);
}

describe('gm build assets safety boundaries', () => {
  it('keeps prerequisite failures machine-readable in --json mode', async () => {
    const cwd = tempDir('gm-build-json-check-');
    writeFileSync(join(cwd, 'assets.lock.json'), '{"version":1}\n');

    const result = await gm(['build', 'assets', '--json'], { cwd, env: {} });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([]);
    expect(result.out).toHaveLength(1);
    expect(JSON.parse(result.out[0]!)).toMatchObject({ allowed: false });
  });

  // A changed or missing file fails only its own asset, by id, with the command that fixes it.
  it('reports a sha-mismatched file as that asset failure with its fix in --json mode', async () => {
    const cwd = tempDir('gm-build-json-sha-');
    mkdirSync(join(cwd, 'assets'), { recursive: true });
    writeFileSync(join(cwd, 'assets/image.png'), ONE_PIXEL_PNG);
    writeImageLock(cwd, 'assets/image.png', '0'.repeat(64));

    const result = await gm(['build', 'assets', '--json'], { cwd, env: {} });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([]);
    expect(JSON.parse(result.out[0]!)).toMatchObject({
      failures: [
        {
          id: 't3:fixture/image',
          message: expect.stringContaining('sha256 does not match the lock. Try: gm assets register assets/image.png'),
        },
      ],
    });
  });

  it('keeps transform failures machine-readable in --json mode', async () => {
    const cwd = tempDir('gm-build-json-transform-');
    const bytes = Buffer.from('unsupported fixture');
    mkdirSync(join(cwd, 'assets'), { recursive: true });
    writeFileSync(join(cwd, 'assets/unsupported.txt'), bytes);
    writeImageLock(cwd, 'assets/unsupported.txt', sha256(bytes));

    const result = await gm(['build', 'assets', '--json'], { cwd, env: {} });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([]);
    expect(result.out).toHaveLength(1);
    expect(JSON.parse(result.out[0]!)).toMatchObject({
      failures: [{ id: 't3:fixture/image', message: 'unsupported asset format .txt' }],
    });
  });

  it('refuses source and output symlinks before writing generated files', async () => {
    const sourceCwd = tempDir('gm-build-source-link-');
    const externalSource = tempDir('gm-build-external-source-');
    writeFileSync(join(externalSource, 'image.png'), ONE_PIXEL_PNG);
    mkdirSync(join(sourceCwd, 'assets'), { recursive: true });
    symlinkSync(join(externalSource, 'image.png'), join(sourceCwd, 'assets/image.png'));
    writeImageLock(sourceCwd);

    const sourceResult = await gm(['build', 'assets'], { cwd: sourceCwd, env: {} });
    expect(sourceResult.code).toBe(2);
    expect(sourceResult.err.join('\n')).toContain('symbolic link');
    expect(existsSync(join(sourceCwd, 'public/assets/manifest.json'))).toBe(false);

    const outputCwd = tempDir('gm-build-output-link-');
    const externalOutput = tempDir('gm-build-external-output-');
    writeImage(outputCwd);
    symlinkSync(externalOutput, join(outputCwd, 'linked-output'), 'dir');

    const outputResult = await gm(['build', 'assets', '--out', 'linked-output'], { cwd: outputCwd, env: {} });
    expect(outputResult.code).toBe(2);
    expect(outputResult.err.join('\n')).toContain('symbolic link');
    expect(existsSync(join(externalOutput, 'manifest.json'))).toBe(false);
  });

  it('rejects traversing filenames from cache metadata', async () => {
    const cwd = tempDir('gm-build-cache-name-');
    const directory = join(cwd, '.gm/cache/assets/safe');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'result.json'),
      JSON.stringify({
        files: { '../escape.bin': { bytes: 1, decoders: [] } },
        assets: {
          't3:fixture/image': {
            file: { '*': '../escape.bin' },
            license: { id: 'CC0-1.0', use: 'any' },
          },
        },
      }),
    );

    await expect(
      loadCached({ sourceHash: 'source', key: 'safe' }, join(cwd, '.gm/cache/assets'), cwd, join(cwd, 'public/assets')),
    ).rejects.toThrow('invalid generated file name');
    expect(existsSync(join(cwd, 'escape.bin'))).toBe(false);
  });

  it('treats cached bytes that do not match their content address as a miss', async () => {
    const cwd = tempDir('gm-build-cache-content-');
    const directory = join(cwd, '.gm/cache/assets/safe');
    const expected = Buffer.from('right');
    const name = `${sha256(expected)}.webp`;
    mkdirSync(join(directory, 'files'), { recursive: true });
    writeFileSync(join(directory, 'files', name), Buffer.from('wrong'));
    writeFileSync(
      join(directory, 'result.json'),
      JSON.stringify({
        files: { [name]: { bytes: expected.length, decoders: [] } },
        assets: {
          't3:fixture/image': {
            file: { '*': name },
            license: { id: 'CC0-1.0', use: 'any' },
          },
        },
      }),
    );

    const outDir = join(cwd, 'public/a');
    await expect(
      loadCached({ sourceHash: 'source', key: 'safe' }, join(cwd, '.gm/cache/assets'), cwd, outDir),
    ).resolves.toBeNull();
    expect(existsSync(join(outDir, name))).toBe(false);
  });

  it('honors --no-cache without creating asset cache entries', async () => {
    const cwd = tempDir('gm-build-no-cache-');
    writeImage(cwd);

    const result = await gm(['build', 'assets', '--no-cache'], { cwd, env: {} });

    expect(result.code).toBe(0);
    expect(existsSync(join(cwd, '.gm/cache/assets'))).toBe(false);
    expect(readFileSync(join(cwd, 'public/assets/manifest.json'), 'utf8')).toContain('t3:fixture/image');
  });
});
