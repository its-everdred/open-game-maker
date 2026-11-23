import { describe, expect, it } from 'vitest';

import { EXIT } from '../src/command.js';
import { frameFailures, isFrameRefusal, type FrameObservation } from '../src/qa-frame-check.js';
import { gm } from './helpers.js';

const seen = (over: Partial<FrameObservation>): FrameObservation => ({
  app: 'https://app.example',
  landed: 'https://app.example',
  drew: true,
  refusals: [],
  ...over,
});

// 2026-11-23: a second app domain the games host would not frame showed Try again in every game (#1297).
describe('frame check verdict', () => {
  it('passes a drawn frame on the app origin and on an alias that redirected to it', () => {
    expect(frameFailures(seen({}))).toEqual([]);
    expect(frameFailures(seen({ app: 'https://bare.example' }), 'https://app.example')).toEqual([]);
  });

  it('fails a refused or empty frame, and a domain that never loaded', () => {
    const refused =
      'Refused to load https://games.example/a.html because it does not appear in the frame-ancestors directive';
    expect(frameFailures(seen({ drew: false, refusals: [refused] }))).toEqual([
      `refused: ${refused}`,
      'the game frame stayed empty',
    ]);
    expect(frameFailures(seen({ landed: null, drew: false, error: 'net::ERR_NAME_NOT_RESOLVED' }))).toEqual([
      'did not load: net::ERR_NAME_NOT_RESOLVED',
    ]);
  });

  // An alias that serves the app itself frames fine when the games host lists it, yet auth and rooms do not trust it.
  it('fails an alias that stays on its own origin instead of redirecting', () => {
    const alias = seen({ app: 'https://bare.example', landed: 'https://bare.example' });
    expect(frameFailures(alias, 'https://app.example')).toEqual([
      'stayed on https://bare.example instead of redirecting to https://app.example',
    ]);
  });

  it("counts only refused frames, not the game's own CSP lines", () => {
    expect(isFrameRefusal("Refused to frame 'https://g.example/' because an ancestor violates frame-ancestors")).toBe(
      true,
    );
    expect(isFrameRefusal("Refused to display 'https://g.example/' in a frame because it set 'X-Frame-Options'")).toBe(
      true,
    );
    expect(isFrameRefusal("Refused to load the image 'https://cdn.example/a.png' because it violates img-src")).toBe(
      false,
    );
    expect(isFrameRefusal("Refused to connect to 'wss://x' because it violates the Content Security Policy")).toBe(
      false,
    );
  });
});

describe('gm qa frame-check usage', () => {
  it('needs one frame url and at least one http(s) app origin', async () => {
    for (const argv of [
      ['qa', 'frame-check', '--app', 'https://app.example'],
      ['qa', 'frame-check', 'https://games.example/g/a/b/'],
      ['qa', 'frame-check', 'https://games.example/g/a/b/', '--app', 'file:///etc'],
      ['qa', 'frame-check', 'https://games.example/g/a/b/', '--app', 'https://app.example', '--timeout', '0'],
    ]) {
      const result = await gm(argv);
      expect([argv.join(' '), result.code]).toEqual([argv.join(' '), EXIT.usage]);
    }
  }, 60_000);
});
