import { expect, it } from 'vitest';
import { parseSceneBrief } from '../src/scene/brief.js';

const brief = {
  image: { width: 390, height: 693 },
  story: 'A trader returns to the yard.',
  mood: 'Quiet dusk',
  light: 'Torchlight from the left',
  focalRegion: 'stall',
  regions: [
    { id: 'stall', label: 'Covered stall', layer: 'landmark', bounds: { x: 20, y: 30, width: 100, height: 80 } },
  ],
};

it('accepts a bounded reviewed decomposition with a focal region', () => {
  expect(parseSceneBrief(brief)).toEqual(brief);
});

it('rejects out-of-image, duplicate and missing focal regions', () => {
  expect(() => parseSceneBrief({ ...brief, focalRegion: 'absent' })).toThrow('focal region does not exist');
  expect(() => parseSceneBrief({ ...brief, regions: [brief.regions[0], brief.regions[0]] })).toThrow(
    'duplicate region id',
  );
  expect(() =>
    parseSceneBrief({ ...brief, regions: [{ ...brief.regions[0], bounds: { x: 389, y: 0, width: 2, height: 1 } }] }),
  ).toThrow('region exceeds image bounds');
});
