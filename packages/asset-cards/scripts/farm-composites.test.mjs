import { test } from 'vitest';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { compose } from './farm-composites.mjs';

test('composes aligned cloned sheets and records their sources', async () => {
  const pack = await mkdtemp(join(tmpdir(), 'farm-composites-'));
  try {
    const root = join(pack, '1.3', 'extracted', 'Farmer_Generator_Pieces', 'Character Pieces');
    const names = [
      ['Bodies', 'Body_1.png', 'Body_2.png', 'Body_3.png'],
      ['Hairstyles', 'Hairstyle_Short_Blonde.png', 'Hairstyle_Short_Brown_Dark.png', 'Hairstyle_Long_Gray.png'],
      ['Outfits', 'Outfit_Dungarees_Red.png', 'Outfit_Dungarees_Green.png', 'Outfit_Dungarees_Black.png'],
    ];
    for (const [folder, ...files] of names) {
      const dir = join(root, folder, '32x32');
      await mkdir(dir, { recursive: true });
      for (const name of files) {
        await sharp({ create: { width: 2, height: 2, channels: 4, background: folder === 'Outfits' ? '#ff0000' : '#00000000' } }).png().toFile(join(dir, name));
      }
    }
    const result = await compose(pack);
    assert.deepEqual(result.order, ['body', 'hair', 'clothes', 'tools']);
    assert.equal(result.examples.length, 3);
    const pixel = await sharp(join(pack, 'sheets', 'farmer-example-1.png')).raw().toBuffer();
    assert.deepEqual([...pixel.subarray(0, 4)], [255, 0, 0, 255]);
    assert.equal(JSON.parse(await readFile(join(pack, 'sheets', 'farmer-layers.json'), 'utf8')).examples.length, 3);
  } finally {
    await rm(pack, { recursive: true, force: true });
  }
});
