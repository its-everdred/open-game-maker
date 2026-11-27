import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { commandMedia, MediaStager } from './media.js';

it('stages permitted attachments and rejects paths outside the configured roots', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'review-media-'));
  try {
    const root = join(tmp, 'assets');
    mkdirSync(root);
    const image = join(root, 'image.png');
    const outside = join(tmp, 'private.png');
    writeFileSync(image, 'image');
    writeFileSync(`${image}.meta.json`, JSON.stringify({ model: 'model-a', cost_usd: 0.25, ai_generated: true }));
    writeFileSync(outside, 'private');
    symlinkSync(outside, join(root, 'link.png'));
    const stager = new MediaStager(join(tmp, 'out'), [root], (source, output) => copyFileSync(source, output));
    const staged = commandMedia([{ locator: { kind: 'path', value: image } }], new Map(), stager)[0];
    expect(staged?.src).toMatch(/^m\/.+\.jpg$/);
    expect(staged?.meta).toEqual({ model: 'model-a', cost: '$0.25', ai: true });
    expect(stager.stage(outside)).toBeUndefined();
    expect(stager.stage(join(root, 'link.png'))).toBeUndefined();
    const missing = join(root, 'deleted.png');
    const legacy = join(root, 'legacy');
    mkdirSync(legacy);
    writeFileSync(
      join(legacy, `${createHash('sha1').update(missing).digest('hex').slice(0, 10)}-deleted.jpg`),
      'snapshot',
    );
    const withLegacy = new MediaStager(
      join(tmp, 'out'),
      [root],
      (source, output) => copyFileSync(source, output),
      legacy,
    );
    expect(withLegacy.stage(missing)?.kind).toBe('img');
    writeFileSync(join(legacy, 'retained.jpg'), 'retained snapshot');
    withLegacy.restoreLegacy('m/retained.jpg');
    expect(readFileSync(join(tmp, 'out/m/retained.jpg'), 'utf8')).toBe('retained snapshot');
    symlinkSync(outside, join(legacy, 'escape.jpg'));
    expect(() => withLegacy.restoreLegacy('m/escape.jpg')).toThrow();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
