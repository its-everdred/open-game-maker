import { expect, it, vi } from 'vitest';
import { SdkHostApi } from './host-api.js';

it('sends haptic requests to the host', () => {
  const send = vi.fn();
  const host = new SdkHostApi(send, () => undefined);
  host.haptics.pulse('heavy');
  host.haptics.pulse([20, 30, 40]);
  expect(send).toHaveBeenNthCalledWith(1, 'haptics.pulse', { pattern: 'heavy' });
  expect(send).toHaveBeenNthCalledWith(2, 'haptics.pulse', { pattern: [20, 30, 40] });
});
