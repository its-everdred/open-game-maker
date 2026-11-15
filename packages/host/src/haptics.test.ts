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
    const haptics = new HapticsController({ nextPulse: 0 });
    haptics.pulse('light');
    haptics.pulse('heavy');
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(10);
    now += 510;
    haptics.pulse([20, 30, 40]);
    expect(vibrate).toHaveBeenLastCalledWith([20, 30, 40]);
    vi.restoreAllMocks();
  });

  it('shares the cooldown across frames', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const first = new HapticsController();
    const second = new HapticsController();
    first.pulse('heavy');
    second.pulse('heavy');
    expect(vibrate).toHaveBeenCalledTimes(1);
    now += 1000;
    first.setSettings({ ...settings, haptics: false });
    second.pulse('heavy');
    expect(vibrate).toHaveBeenCalledTimes(1);
    localStorage.setItem('ogm.settings', JSON.stringify({ haptics: true }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'ogm.settings' }));
    second.pulse('light');
    expect(vibrate).toHaveBeenCalledTimes(2);
    localStorage.removeItem('ogm.settings');
    vi.restoreAllMocks();
  });

  it('loads the saved opt-out before a frame receives settings', () => {
    localStorage.setItem('ogm.settings', JSON.stringify({ haptics: false }));
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const haptics = new HapticsController({ nextPulse: 0 });
    haptics.pulse('heavy');
    expect(vibrate).not.toHaveBeenCalled();
    haptics.setSettings(settings);
    haptics.pulse('heavy');
    expect(vibrate).toHaveBeenCalledWith(50);
    localStorage.removeItem('ogm.settings');
  });

  it('honours the setting and reduced motion', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const haptics = new HapticsController({ nextPulse: 0 });
    haptics.setSettings({ ...settings, haptics: false });
    haptics.pulse('heavy');
    haptics.setSettings({ ...settings, reduceMotion: true });
    haptics.pulse('heavy');
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    haptics.setSettings(settings);
    haptics.pulse('heavy');
    expect(vibrate).not.toHaveBeenCalled();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    haptics.pulse('heavy');
    expect(vibrate).toHaveBeenCalledWith(50);
  });
});
