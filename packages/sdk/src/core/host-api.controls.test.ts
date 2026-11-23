import { expect, it } from 'vitest';
import { SdkHostApi } from './host-api.js';

it('tells the host which touch controls each screen needs', () => {
  const sent: [string, unknown][] = [];
  const host = new SdkHostApi(
    (type, payload) => sent.push([type, payload]),
    () => undefined,
  );
  host.controls.set({ layout: 'none' });
  host.controls.set({ layout: 'menu' });
  host.controls.set({ layout: 'gameplay' });
  expect(sent).toEqual([
    ['host.controls', { layout: 'none' }],
    ['host.controls', { layout: 'menu' }],
    ['host.controls', { layout: 'gameplay' }],
  ]);
});
