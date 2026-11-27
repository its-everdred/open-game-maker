import { expect, it } from 'vitest';
import { parityBridgePort } from './parity-bridge';

it('uses the browser server default or the explicit bridge override', () => {
  expect(parityBridgePort({})).toBe('10001');
  expect(parityBridgePort({ OGM_WEB_BRIDGE_PORT: '43176' })).toBe('43176');
});
