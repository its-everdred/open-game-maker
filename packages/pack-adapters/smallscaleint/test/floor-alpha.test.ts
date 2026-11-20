import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isoToWorld } from '../src/index.js';
import { realGroundTile } from './fixtures/ground-path.js';

// Decode the 8-bit RGBA PNGs used by these fixtures, including all PNG row filters.
function readAlpha(path: string) {
  const png = readFileSync(path);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0) throw new Error('Expected non-interlaced 8-bit RGBA PNG');
  const chunks: Buffer[] = [];
  for (let pos = 8; pos < png.length;) {
    const size = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') chunks.push(png.subarray(pos + 8, pos + 8 + size));
    pos += size + 12;
  }
  const data = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const [da, db, dc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= 4 ? pixels[i - 4]! : 0;
      const b = y ? pixels[i - stride]! : 0;
      const c = y && x >= 4 ? pixels[i - stride - 4]! : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : filter === 4
                  ? paeth(a, b, c)
                  : NaN;
      if (Number.isNaN(predictor)) throw new Error(`Unknown PNG filter ${filter}`);
      pixels[i] = (data[y * (stride + 1) + x + 1]! + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function expectJoined(path: string) {
  const image = readAlpha(path);
  const alphaAt = (worldX: number, worldY: number) => {
    let alpha = 0;
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const point = isoToWorld(x, y);
        const px = worldX - point.x + image.width / 2;
        const py = worldY - point.y + 208;
        if (px >= 0 && px < image.width && py >= 0 && py < image.height)
          alpha = Math.max(alpha, image.pixels[(py * image.width + px) * 4 + 3]!);
      }
    return alpha;
  };
  // Walk all four shared edges, excluding the four-way corners.
  for (let x = 2; x < 64; x += 2) {
    for (const [px, py] of [
      [x, 32 - x / 2],
      [-x, 32 - x / 2],
      [x, 64 - x / 2],
      [-x, 64 - x / 2],
    ]) {
      expect(alphaAt(px!, py!), `transparent seam at ${px},${py}`).toBeGreaterThanOrEqual(200);
    }
  }
}

const fixture = fileURLToPath(new URL('./fixtures/ground-diamond.png', import.meta.url));
const real = realGroundTile();
describe('ground tile alpha coverage', () => {
  it('joins a 2x2 floor using the committed diamond fixture', () => expectJoined(fixture));
  it.skipIf(!real)('joins a 2x2 floor using a library tile (skipped when assets-local is absent)', () =>
    expectJoined(real),
  );
});
