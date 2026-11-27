import { expect, it } from 'vitest';
import { isReservedGameSlug } from '../src/game-links.js';

it('reserves the marketing site factory asset path from game slugs', () => {
  expect(isReservedGameSlug('factory')).toBe(true);
});
