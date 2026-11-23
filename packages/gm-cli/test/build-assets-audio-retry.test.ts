import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LockEntry } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { buildAudio, type Mp3Encoder } from '../src/commands/build/assets/audio.js';
import { loadCached, saveBuilt } from '../src/commands/build/assets/cache.js';
import { sha256 } from '../src/commands/build/assets/files.js';
import type { BuildJob } from '../src/commands/build/assets/types.js';
import { tempDir } from './helpers.js';

const MP3 = Buffer.from('ID3 fake mp3 bytes');

function job(): BuildJob {
  const source = join(tempDir('gm-audio-source-'), 'theme.wav');
  writeFileSync(source, 'RIFF');
  const entry = {
    id: 't3:fixture/music/theme',
    license: 'CC0-1.0',
    rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: null },
  } as unknown as LockEntry;
  return {
    kind: 'audio',
    cacheKind: 'music',
    slug: 'theme',
    items: [{ entry, source }],
    tiers: ['mobile'],
    recipe: {},
  };
}

/** An encoder that plays back a script of outcomes, one per call: 'fail' (Conversion failed), 'empty' or 'ok'. */
function scripted(outcomes: Array<'fail' | 'empty' | 'ok'>): { encode: Mp3Encoder; calls: () => number } {
  let calls = 0;
  const encode: Mp3Encoder = async (_source, target) => {
    const outcome = outcomes[calls++];
    if (outcome === 'fail') {
      writeFileSync(target, '');
      throw Object.assign(new Error('Command failed: ffmpeg'), { stderr: 'Error while filtering\nConversion failed!' });
    }
    writeFileSync(target, outcome === 'empty' ? '' : MP3);
  };
  return { encode, calls: () => calls };
}

describe('gm build assets audio conversion under load', () => {
  it('retries a failed conversion once and keeps the failed stderr in the build log', async () => {
    const log: string[] = [];
    const { encode, calls } = scripted(['fail', 'ok']);

    const built = await buildAudio(job(), (line) => log.push(line), encode);

    expect(calls()).toBe(2);
    expect(Object.values(built.buffers)).toEqual([MP3]);
    expect(log.join('\n')).toContain('Conversion failed!');
  });

  it('treats a 0-byte output as a failure and gives up after one retry', async () => {
    const log: string[] = [];
    const { encode, calls } = scripted(['empty', 'empty', 'ok']);

    await expect(buildAudio(job(), (line) => log.push(line), encode)).rejects.toThrow('ffmpeg wrote an empty file');
    expect(calls()).toBe(2);
    expect(log).toHaveLength(2);
  });

  it('never caches a 0-byte output and never serves one an older build cached', async () => {
    const cwd = tempDir('gm-audio-cache-');
    const cacheDir = join(cwd, '.gm/cache/assets');
    const outDir = join(cwd, 'public/a');
    const empty = Buffer.alloc(0);
    const name = `${sha256(empty)}.mp3`;
    const result = {
      files: { [name]: { bytes: 0, decoders: [] } },
      assets: { 't3:fixture/music/theme': { file: { '*': name }, license: { id: 'CC0-1.0', use: 'any' as const } } },
    };

    await saveBuilt({ sourceHash: 'source', key: 'fresh' }, cacheDir, cwd, outDir, {
      ...result,
      buffers: { [name]: empty },
    });
    expect(() => readdirSync(cacheDir)).toThrow();

    mkdirSync(join(cacheDir, 'poisoned/files'), { recursive: true });
    writeFileSync(join(cacheDir, 'poisoned/files', name), empty);
    writeFileSync(join(cacheDir, 'poisoned/result.json'), JSON.stringify(result));
    await expect(loadCached({ sourceHash: 'source', key: 'poisoned' }, cacheDir, cwd, outDir)).resolves.toBeNull();
  });
});
