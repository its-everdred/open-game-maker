import { afterEach, describe, expect, it, vi } from 'vitest';
import { HapticsController } from './haptics.js';

const settings = { mute: false, volume: 1, textScale: 1, reduceMotion: false };

afterEach(() => vi.unstubAllGlobals());

describe('haptics', () => {
  it('plays strengths and patterns with a quiet interval', () => {
    const vibrate = vi.fn();
    let now = 1000;
    vi.stubGlobal('navigator', { vibrate });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const haptics = new HapticsController();
    haptics.pulse('light');
    haptics.pulse('heavy');
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(10);
    now += 510;
    haptics.pulse([20, 30, 40]);
    expect(vibrate).toHaveBeenLastCalledWith([20, 30, 40]);
    vi.restoreAllMocks();
  });

  it('honours the setting and reduced motion', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const haptics = new HapticsController();
    haptics.setSettings({ ...settings, haptics: false });
    haptics.pulse('heavy');
    haptics.setSettings({ ...settings, reduceMotion: true });
    haptics.pulse('heavy');
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    haptics.setSettings(settings);
    haptics.pulse('heavy');
    expect(vibrate).not.toHaveBeenCalled();
  });
});
