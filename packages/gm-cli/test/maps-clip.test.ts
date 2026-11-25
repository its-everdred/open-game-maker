import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';
import type { LayoutRow } from '@ogm/asset-cards';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('node:fs', () => ({ existsSync: () => true }));
vi.mock('../src/packs/workers.js', () => ({
  resolvePython: async () => '/legacy/python',
  workerEnvironment: () => ({ HF_HUB_OFFLINE: '1' }),
}));

import { clipScores } from '../src/maps/clip.js';

describe('map CLIP scoring', () => {
  it('sends only vision-eligible rows and accepts only their finite scores', async () => {
    let input = '';
    spawnMock.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        kill: vi.fn(),
      });
      child.stdin.on('data', (chunk: Buffer) => {
        input += chunk.toString();
      });
      child.stdin.on('finish', () => {
        child.stdout.end(JSON.stringify({ allowed: 0.6, other: 0.9, invalid: 3 }));
        child.emit('close', 0);
      });
      return child;
    });
    const row = {
      id: 'allowed',
      thumbnail: 'thumb',
      source_folder: 'inspiration/a',
      source_file: 'maps/a.png',
      content_hash: 'sha256:a',
    } as LayoutRow;
    const scores = await clipScores('/library', 'cave', [
      { ...row, thumbnail: undefined },
      { ...row, id: 'invalid' },
      { ...row, id: 'hidden', source_folder: undefined },
    ]);
    expect(spawnMock.mock.calls.at(-1)?.[0]).toBe('/legacy/python');
    expect(JSON.parse(input).rows.map((entry: { id: string }) => entry.id)).toEqual(['allowed', 'invalid']);
    expect([...scores!]).toEqual([['allowed', 0.6]]);
  });
});
