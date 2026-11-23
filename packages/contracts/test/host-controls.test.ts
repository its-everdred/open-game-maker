import { expect, it } from 'vitest';
import { gameToHostSchema } from '../src/bridge.js';

const message = (payload: unknown) => ({ v: 1, id: '1', t: 'host.controls', payload });

it('lets a game pick the touch controls a screen needs, and only by a layout name the shell knows', () => {
  for (const layout of ['none', 'menu', 'gameplay']) {
    expect(gameToHostSchema.safeParse(message({ layout })).success).toBe(true);
  }
  for (const payload of [{}, { layout: 'hidden' }, { layout: false }, { visible: false }]) {
    expect(gameToHostSchema.safeParse(message(payload)).success).toBe(false);
  }
});
