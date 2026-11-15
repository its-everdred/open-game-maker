import { describe, expect, it } from 'vitest';

import { scriptedFrames } from '../src/trailer-frames.js';

const action = (t: number, name: string) => ({ t, action: name, phase: 'down' as const, playerIndex: 0 });

describe('scripted trailer frames', () => {
  it('advances and injects in game-time order before capturing each frame', async () => {
    let time = 0;
    const events: string[] = [];
    const hooks = {
      advanceTime: async (ms: number) => {
        time += ms;
      },
      inject: async (frame: { actions: Record<string, unknown> }) => {
        events.push(`input ${Object.keys(frame.actions)[0]} ${time}`);
      },
    };
    await scriptedFrames(hooks, [action(0.5, 'drop'), action(0, 'start'), action(0.25, 'left')], 1, 2, async (i) => {
      events.push(`frame ${i} ${time}`);
    });
    expect(events).toEqual(['input start 0', 'frame 0 0', 'input left 250', 'input drop 500', 'frame 1 500']);
  });

  it('rejects inputs outside the clip', async () => {
    const hooks = { advanceTime: async () => {}, inject: async () => {} };
    await expect(scriptedFrames(hooks, [action(1, 'drop')], 1, 30, async () => {})).rejects.toThrow(
      'within the recording',
    );
  });
});
