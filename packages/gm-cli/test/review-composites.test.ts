import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { buildComposites } from '../src/review-composites.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gm-review-composites-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const still = join(root, 'still.png');
  await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff0000' } })
    .png()
    .toFile(still);
  return { root, still };
}

describe('review composites', () => {
  it('places slot art at its 2x display box on a 2x viewport canvas', async () => {
    const { root, still } = await fixture();
    const [composite] = await buildComposites(
      [{ kind: 'still', ref: still, slot: 'tile', viewport: 'phone-portrait' }],
      root,
    );
    expect(composite?.viewport).toBe('phone-portrait');
    const image = sharp(composite!.path);
    expect(await image.metadata()).toMatchObject({ width: 780, height: 1688 });
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    const centerX = Math.floor(info.width / 2);
    const centerY = Math.floor(info.height / 2);
    const red = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return data[offset] === 255 && data[offset + 1] === 0;
    };
    expect(red(centerX - 175, centerY - 98)).toBe(true);
    expect(red(centerX + 176, centerY - 98)).toBe(false);
    expect(red(centerX - 175, centerY + 99)).toBe(false);
  });

  it('returns supported viewports with phone portrait first', async () => {
    const { root, still } = await fixture();
    const composites = await buildComposites([{ kind: 'still', ref: still, slot: 'tile' }], root);
    expect(composites.map(({ viewport }) => viewport)).toEqual([
      'phone-portrait',
      'phone-landscape',
      'tablet-portrait',
      'tablet-landscape',
    ]);
  });

  it('refuses slotted art without phone portrait', async () => {
    const { root, still } = await fixture();
    const { command } = await import('../src/commands/review/post.js');
    const submission = {
      id: 'd9428888-122b-4b0e-b1c8-9f7900000001',
      track: 'game',
      phase: 'build',
      category: 'art',
      ticket: '42',
      sha: 'a'.repeat(40),
      media: [{ kind: 'still', ref: `file:${still}`, slot: 'tile', viewport: 'desktop' }],
    };
    const submissionPath = join(root, 'submission.json');
    await writeFile(submissionPath, JSON.stringify(submission));
    await expect(
      command.run(
        {
          cwd: root,
          assetsRoot: null,
          skillsDir: null,
          config: { verifySoftwareGl: false, verifyQueue: false },
          json: false,
          limit: 20,
          fields: null,
          out: () => undefined,
          err: () => undefined,
          emit: () => undefined,
          blobRoot: null,
          blobApi: null,
          blocklistFile: null,
          home: root,
        },
        [submissionPath],
        {},
      ),
    ).rejects.toThrow('art round needs a phone-portrait image (aspect sets, gm-image-mock)');
  });
});
