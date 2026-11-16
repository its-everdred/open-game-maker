import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, it } from 'vitest';
import { gm, tempDir } from './helpers.js';

it('refuses a sound review containing only an audio file', async () => {
  const root = tempDir('gm-review-post-');
  const file = join(root, 'round.json');
  writeFileSync(
    file,
    JSON.stringify({
      id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
      track: 'sound',
      phase: 'concept',
      category: 'sound',
      ticket: '42',
      sha: 'a'.repeat(40),
      media: [{ kind: 'audio', ref: 'cue.wav' }],
    }),
  );
  const result = await gm(['review', 'post', file], { cwd: root });
  expect(result.code).not.toBe(0);
  expect(result.err.join(' ')).toContain('sound requires a capture clip with audio');
});

it.each([
  { category: 'art', phase: 'concept', kind: 'still', filename: 'still.png', mime: 'image/png' },
  { category: 'sound', phase: 'mock', kind: 'audio', filename: 'cue.wav', mime: 'audio/wav' },
])(
  'submits $kind from a worker using its scoped relay credential',
  async ({ category, phase, kind, filename, mime }) => {
    const root = tempDir('gm-review-post-worker-');
    execFileSync('git', ['init', '-q'], { cwd: root });
    const game = join(root, 'games', 'castle-game');
    const context = join(root, '.gm', 'context');
    const relay = join(root, '.gm', 'preview');
    mkdirSync(game, { recursive: true });
    mkdirSync(context, { recursive: true });
    mkdirSync(relay, { recursive: true });
    writeFileSync(join(game, 'gm.manifest.json'), '{}');
    writeFileSync(join(context, 'preview.json'), JSON.stringify({ token: 'scoped-token' }));
    const submission = {
      id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
      track: category,
      phase,
      category,
      ticket: '42',
      sha: 'a'.repeat(40),
      media: [{ kind, ref: 'file:' + join(root, filename) }],
    };
    const image = Buffer.from('test image');
    writeFileSync(join(root, filename), image);
    const file = join(root, 'round.json');
    writeFileSync(file, JSON.stringify(submission));
    let handled = false;
    const watcher = watch(relay, (_event, name) => {
      if (handled || !name?.endsWith('.json')) return;
      handled = true;
      const request = JSON.parse(readFileSync(join(relay, name), 'utf8')) as {
        token: string;
        submission: typeof submission;
        attachments: { index: number; mime: string }[];
      };
      expect(request.token).toBe('scoped-token');
      expect(request.submission.media[0]!.ref).toBe(`sha256:${createHash('sha256').update(image).digest('hex')}`);
      expect(request.attachments).toEqual([{ index: 0, mime }]);
      expect(readFileSync(join(relay, name.replace(/\.json$/u, '.0.media')))).toEqual(image);
      writeFileSync(
        join(relay, name.replace(/\.json$/u, '.response')),
        JSON.stringify({ state: 'done', id: submission.id, round: 1 }),
      );
    });
    try {
      const result = await gm(['review', 'post', file], { cwd: game });
      expect(result.code).toBe(0);
      expect(JSON.parse(result.out[0]!)).toEqual({ id: submission.id, round: 1 });
    } finally {
      watcher.close();
    }
  },
);
