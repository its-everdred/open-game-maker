import { describe, expect, it } from 'vitest';

import { scriptedFrames } from '../src/trailer-frames.js';

const action = (t: number, name: string) => ({ t, action: name, phase: 'down' as const, playerIndex: 0 });

describe('scripted trailer frames', () => {
  it('keeps a logical input held through simulation ticks and releases it', async () => {
    let time = 0;
    const frames: Array<Record<string, unknown>> = [];
    const captures: number[] = [];
    const hooks = {
      advanceTime: async (ms: number) => {
        time += ms;
      },
      inject: async (frame: { actions: Record<string, unknown> }) => {
        frames.push(frame.actions);
      },
    };
    await scriptedFrames(
      hooks,
      [action(0, 'softDrop'), { ...action(0.25, 'softDrop'), phase: 'up' }],
      1,
      2,
      async () => {
        captures.push(time);
      },
    );
    expect(captures[0]).toBe(0);
    expect(captures[1]).toBeCloseTo(500);
    expect(frames.filter((frame) => frame.softDrop === true)).toHaveLength(15);
    expect(frames.filter((frame) => frame.softDrop === false)).toHaveLength(1);
  });

  it('clicks HTML controls before the next frame', async () => {
    const events: string[] = [];
    const hooks = {
      advanceTime: async () => {},
      inject: async () => {},
      click: async (selector: string) => {
        events.push(`click ${selector}`);
      },
    };
    await scriptedFrames(hooks, [{ t: 0.2, click: '[data-play]' }], 1, 2, async (i) => {
      events.push(`frame ${i}`);
    });
    expect(events).toEqual(['frame 0', 'click [data-play]', 'frame 1']);
  });

  it('processes inputs in the final frame interval without creating another frame', async () => {
    const inputs: Record<string, unknown>[] = [];
    let time = 0;
    let captures = 0;
    const hooks = {
      advanceTime: async (ms: number) => {
        time += ms;
      },
      inject: async (frame: { actions: Record<string, unknown> }) => {
        inputs.push(frame.actions);
      },
    };
    await scriptedFrames(hooks, [action(0.75, 'drop')], 1, 1, async () => {
      captures++;
    });
    expect(captures).toBe(1);
    expect(time).toBeCloseTo(1000);
    expect(inputs.some((frame) => frame.drop === true)).toBe(true);
  });

  it('rejects inputs outside the clip', async () => {
    const hooks = { advanceTime: async () => {}, inject: async () => {} };
    await expect(scriptedFrames(hooks, [action(1, 'drop')], 1, 30, async () => {})).rejects.toThrow(
      'within the recording',
    );
  });
});
