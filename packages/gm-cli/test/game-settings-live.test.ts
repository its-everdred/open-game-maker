import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GmContext } from '../src/command.js';
import { allowsAiGeneratedAssets } from '../src/game-settings.js';
import { tempDir } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('live game asset preference', () => {
  it('reads each current setting and refuses when the daemon cannot be reached', async () => {
    const cwd = tempDir('gm-live-setting-');
    execFileSync('git', ['init', '-q'], { cwd });
    mkdirSync(join(cwd, '.gm', 'context'), { recursive: true });
    writeFileSync(
      join(cwd, '.gm', 'context', 'bundle.json'),
      JSON.stringify({ gameId: 'g1', gameContext: { allowAiGeneratedAssets: true } }),
    );
    const secretFile = join(cwd, 'secret');
    writeFileSync(secretFile, 'test-secret');
    const ctx = { cwd, blobApi: { url: 'http://127.0.0.1:1234', secretFile }, config: { aiurIssue: 12 } } as GmContext;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ allowAiGeneratedAssets: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ allowAiGeneratedAssets: true })))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await allowsAiGeneratedAssets(ctx)).toBe(false);
    expect(await allowsAiGeneratedAssets(ctx)).toBe(true);
    await expect(allowsAiGeneratedAssets(ctx)).rejects.toThrow('cannot read live AI-generated asset preference');
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain('/internal/games/g1/ai-assets');
    await expect(allowsAiGeneratedAssets({ ...ctx, blobApi: null })).rejects.toThrow(
      'cannot read live AI-generated asset preference',
    );
    unlinkSync(join(cwd, '.gm', 'context', 'bundle.json'));
    writeFileSync(join(cwd, '.gm', 'context', 'bundle.missing'), 'unavailable');
    await expect(allowsAiGeneratedAssets(ctx)).rejects.toThrow('cannot read live AI-generated asset preference');
  });
});
