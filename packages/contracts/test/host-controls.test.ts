import { expect, it } from 'vitest';
import { gameToHostSchema } from '../src/bridge.js';

const message = (payload: unknown) => ({ v: 1, id: '1', t: 'host.controls', payload });

it('lets a game pick the touch controls a screen needs, with bounded names for declared control sets', () => {
  for (const layout of ['none', 'menu', 'gameplay', 'conversation']) {
    expect(gameToHostSchema.safeParse(message({ layout })).success).toBe(true);
  }
  for (const payload of [{}, { layout: 'bad name' }, { layout: false }, { visible: false }]) {
    expect(gameToHostSchema.safeParse(message(payload)).success).toBe(false);
  }
});
