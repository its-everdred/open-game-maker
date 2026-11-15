import { afterEach, expect, it, vi } from 'vitest';
import { HostBridge } from './bridge.js';
import { createGameFrame } from './frame.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('routes game requests through the frame setting', () => {
  let pulse: ((payload: { pattern: 'heavy' }) => void) | undefined;
  const on = vi.spyOn(HostBridge.prototype, 'on');
  on.mockImplementation(function (type, callback) {
    if (type === 'haptics.pulse') pulse = callback as typeof pulse;
    return () => undefined;
  } as typeof HostBridge.prototype.on);
  const vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
  const frame = createGameFrame({
    container: document.body,
    gamesOrigin: 'https://games.test',
    appOrigin: 'https://app.test',
    gameId: 'g',
    buildId: 'b',
    build: 'draft',
    mode: 'play',
    playerIndex: 0,
    capabilities: [],
    role: () => 'owner',
  });
  frame.setSettings({ mute: false, volume: 1, textScale: 1, reduceMotion: false, haptics: false });
  pulse?.({ pattern: 'heavy' });
  expect(vibrate).not.toHaveBeenCalled();
  frame.setSettings({ mute: false, volume: 1, textScale: 1, reduceMotion: false, haptics: true });
  pulse?.({ pattern: 'heavy' });
  expect(vibrate).toHaveBeenCalledWith(50);
  frame.dispose();
  delete (navigator as Partial<Navigator>).vibrate;
});
