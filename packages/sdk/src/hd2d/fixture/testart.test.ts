import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function hash(buffer: Uint8ClampedArray): string {
  let value = 0x811c9dc5;
  for (const byte of buffer) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  return value.toString(16).padStart(8, '0');
}

describe('procedural HD-2D test art', () => {
  beforeEach(() =>
    vi.stubGlobal('document', {
      createElement: () => {
        const result = { width: 0, height: 0 } as HTMLCanvasElement;
        const pixels = new Uint8ClampedArray(128 * 128 * 4);
        const context = {
          imageSmoothingEnabled: false,
          fillStyle: '',
          fillRect(x: number, y: number, width: number, height: number) {
            for (let row = y; row < y + height; row += 1)
              for (let col = x; col < x + width; col += 1) {
                const i = (row * result.width + col) * 4;
                pixels[i] = (x + y + width) & 255;
                pixels[i + 1] = (y + height) & 255;
                pixels[i + 2] = col & 255;
                pixels[i + 3] = 255;
              }
          },
          getImageData: () => ({ data: pixels.slice(0, result.width * result.height * 4) }),
          createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData(image: { data: Uint8ClampedArray }) {
            pixels.set(image.data);
          },
          beginPath() {},
          arc() {},
          fill() {},
          createRadialGradient: () => ({ addColorStop() {} }),
          drawImage(source: HTMLCanvasElement, ...args: number[]) {
            const sourcePixels = source.getContext('2d')!.getImageData(0, 0, source.width, source.height).data;
            const [dx, dy, dw = source.width, dh = source.height] = args;
            for (let y = 0; y < dh; y += 1) {
              for (let x = 0; x < dw; x += 1) {
                const sourceX = Math.floor((x / dw) * source.width);
                const sourceY = Math.floor((y / dh) * source.height);
                const from = (sourceY * source.width + sourceX) * 4;
                const toX = Math.floor(dx + x);
                const toY = Math.floor(dy + y);
                if (toX < 0 || toY < 0 || toX >= result.width || toY >= result.height) continue;
                const to = (toY * result.width + toX) * 4;
                pixels.set(sourcePixels.slice(from, from + 4), to);
              }
            }
          },
        };
        result.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
        return result;
      },
    }),
  );
  afterEach(() => vi.unstubAllGlobals());

  it('creates stable seeded buffers and a matching normal map', async () => {
    const { createTestArt } = await import('./testart.js');
    const art = createTestArt(1);
    expect(art.heroNormal.width).toBe(art.hero.width);
    expect(art.heroNormal.height).toBe(art.hero.height);
    expect({
      hero: hash(art.hero.getContext('2d')!.getImageData(0, 0, art.hero.width, art.hero.height).data),
      heroNormal: hash(
        art.heroNormal.getContext('2d')!.getImageData(0, 0, art.heroNormal.width, art.heroNormal.height).data,
      ),
      tree: hash(art.tree.getContext('2d')!.getImageData(0, 0, art.tree.width, art.tree.height).data),
      trunk: hash(art.trunk.getContext('2d')!.getImageData(0, 0, art.trunk.width, art.trunk.height).data),
      canopy: hash(art.canopy.getContext('2d')!.getImageData(0, 0, art.canopy.width, art.canopy.height).data),
      leaves: hash(art.leaves.getContext('2d')!.getImageData(0, 0, art.leaves.width, art.leaves.height).data),
      mote: hash(art.mote.getContext('2d')!.getImageData(0, 0, art.mote.width, art.mote.height).data),
    }).toMatchInlineSnapshot(`
      {
        "canopy": "87b5905e",
        "hero": "93d60cba",
        "heroNormal": "7ca8fd9c",
        "leaves": "d9d5b455",
        "mote": "8e0a75c5",
        "tree": "a29c8a06",
        "trunk": "fca475db",
      }
    `);
  });
});
