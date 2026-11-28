import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { verifyGlassReference } from './reference.js';

it('rejects changed, missing, and ambiguous approved references', () => {
  const image = Buffer.from('approved');
  const manifest = [{ file: 'Home.png', pngSha256: createHash('sha256').update(image).digest('hex') }];
  expect(() => verifyGlassReference(image, manifest, 'Home.png')).not.toThrow();
  expect(() => verifyGlassReference(Buffer.from('changed'), manifest, 'Home.png')).toThrow('hash mismatch');
  expect(() => verifyGlassReference(image, manifest, 'Other.png')).toThrow('hash mismatch');
  expect(() => verifyGlassReference(image, [...manifest, ...manifest], 'Home.png')).toThrow('hash mismatch');
});
