import { expect, it, vi } from 'vitest';
import { SdkHostApi } from './host-api.js';

it('tells the shell to hide the Pause control on a game menu and show it again in play', () => {
  const send = vi.fn();
  const host = new SdkHostApi(send, vi.fn());
  host.setHostPauseVisible(false);
  host.setHostPauseVisible(true);
  expect(send.mock.calls).toEqual([
    ['host.pause.visible', { visible: false }],
    ['host.pause.visible', { visible: true }],
  ]);
});
