import { expect, it } from 'vitest';
import { gameToHostSchema } from '../src/bridge.js';

const message = (payload: unknown) => ({ v: 1, id: '1', t: 'host.pause.visible', payload });

it('lets a game show or hide the host Pause control, and only with a boolean the shell cannot misread', () => {
  expect(gameToHostSchema.safeParse(message({ visible: false })).success).toBe(true);
  expect(gameToHostSchema.safeParse(message({ visible: true })).success).toBe(true);
  for (const payload of [{}, { visible: 'false' }, { visible: 0 }, { visible: null }]) {
    expect(gameToHostSchema.safeParse(message(payload)).success).toBe(false);
  }
});
