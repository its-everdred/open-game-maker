import { deflateSync } from 'node:zlib';

/**
 * Stand-in iso sprites for the map maker check (#1209): 256x256 facing images whose ground diamond sits where the
 * SmallScaleInt pack draws it (128x64, centred 208 px down), so the editor's picking and placement are exercised on the
 * same geometry without committing paid pack art.
 */
export type Shape = 'floor' | 'wall' | 'decor';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes: Buffer): number {
  let c = -1;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function inDiamond(x: number, y: number, cx: number, cy: number, halfWidth: number, halfHeight: number): boolean {
  return Math.abs(x - cx) / halfWidth + Math.abs(y - cy) / halfHeight <= 1;
}

/** One facing: `facing` tilts a marker so a turn is visible in stills. */
export function spritePng(shape: Shape, rgb: readonly [number, number, number], facing: string): Buffer {
  const size = 256;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const marker = { E: [40, 0], N: [0, -20], W: [-40, 0], S: [0, 20] }[facing] ?? [0, 0];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      let shade = 1;
      if (shape === 'floor' && inDiamond(x, y, 128, 208, 64, 32)) alpha = 255;
      if (shape === 'wall' && Math.abs(x - 128) <= 28 && y >= 96 && y <= 224) {
        alpha = 255;
        shade = x < 128 ? 0.8 : 1;
      }
      if (shape === 'decor' && Math.hypot(x - 128, y - 176) <= 30) alpha = 255;
      if (alpha && Math.hypot(x - 128 - marker[0]! / 2, y - (shape === 'floor' ? 208 : 176) - marker[1]! / 2) < 7) {
        shade = 0.35;
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      raw[offset] = Math.round(rgb[0] * shade);
      raw[offset + 1] = Math.round(rgb[1] * shade);
      raw[offset + 2] = Math.round(rgb[2] * shade);
      raw[offset + 3] = alpha;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
