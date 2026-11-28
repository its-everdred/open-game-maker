import { expect, it } from 'vitest';
import { rewriteRootReferences } from '../src/root-references.js';

it('rewrites references in a multi-megabyte legacy bundle without overflowing', () => {
  const large = '\\x'.repeat(16 * 1024 * 1024);
  const input = `const data = "${large}"; const asset = "/media/logo.png";`;
  expect(rewriteRootReferences(input, (value) => (value.startsWith('/') ? `/game${value}` : value))).toBe(
    `const data = "${large}"; const asset = "/game/media/logo.png";`,
  );
});
