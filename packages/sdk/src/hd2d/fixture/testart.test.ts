import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function hash(buffer: Iterable<number>): string {
  let value = 0x811c9dc5;
  for (const byte of buffer) value = Math.imul(value ^ byte, 0x01000193) >>> 0;
  return value.toString(16).padStart(8, '0');
}

/** '#rrggbb' as itself; anything else (rgba strings, gradients) as a colour derived from its full description. */
function rgba(style: unknown): number[] {
  if (typeof style === 'string' && /^#[0-9a-f]{6}$/i.test(style))
    return [1, 3, 5].map((at) => parseInt(style.slice(at, at + 2), 16)).concat(255);
  const value = Number.parseInt(hash(new TextEncoder().encode(JSON.stringify(style))), 16);
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, 255];
}

describe('procedural HD-2D test art', () => {
  beforeEach(() =>
    vi.stubGlobal('document', {
      createElement: () => {
        const result = { width: 0, height: 0 } as HTMLCanvasElement;
        const pixels = new Uint8ClampedArray(128 * 128 * 4);
        let circle = [0, 0, 0];
        const context = {
          imageSmoothingEnabled: false,
          fillStyle: '' as unknown,
          fillRect(x: number, y: number, width: number, height: number) {
            const color = rgba(context.fillStyle);
            for (let row = Math.max(0, y); row < Math.min(result.height, y + height); row += 1)
              for (let col = Math.max(0, x); col < Math.min(result.width, x + width); col += 1)
                pixels.set(color, (row * result.width + col) * 4);
          },
          getImageData: () => ({ data: pixels.slice(0, result.width * result.height * 4) }),
          createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData(image: { data: Uint8ClampedArray }) {
            pixels.set(image.data);
          },
          beginPath() {},
          arc(x: number, y: number, radius: number) {
            circle = [x, y, radius];
          },
          fill() {
            const [cx, cy, radius] = circle;
            const color = rgba(context.fillStyle);
            for (let row = Math.max(0, cy - radius); row < Math.min(result.height, cy + radius); row += 1)
              for (let col = Math.max(0, cx - radius); col < Math.min(result.width, cx + radius); col += 1)
                if ((col - cx) ** 2 + (row - cy) ** 2 <= radius ** 2) pixels.set(color, (row * result.width + col) * 4);
          },
          createRadialGradient: (...args: number[]) => {
            const stops: unknown[] = [];
            return { args, stops, addColorStop: (offset: number, color: string) => stops.push(offset, color) };
          },
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
        "canopy": "f6d79c3f",
        "hero": "a017d951",
        "heroNormal": "7ca8fd9c",
        "leaves": "f1b2704b",
        "mote": "f3d12dc5",
        "tree": "a38e3baa",
        "trunk": "d7e59d53",
      }
    `);
  });
});
