import { describe, expect, it } from 'vitest';
import { gameToHostSchema } from '../src/bridge.js';

const message = (payload: unknown) => ({ v: 1, id: '1', t: 'host.pause.visible', payload });

describe('host.pause.visible', () => {
  it('lets a game show or hide the host Pause control', () => {
    expect(gameToHostSchema.safeParse(message({ visible: false })).success).toBe(true);
    expect(gameToHostSchema.safeParse(message({ visible: true })).success).toBe(true);
  });

  it('rejects a payload the shell could misread as hidden', () => {
    for (const payload of [{}, { visible: 'false' }, { visible: 0 }, { visible: null }]) {
      expect(gameToHostSchema.safeParse(message(payload)).success).toBe(false);
    }
  });
});
