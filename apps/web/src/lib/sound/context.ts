// One Web Audio context for the whole app (a port of prototypes/studio-v0/sound.js). Browsers only start audio after a
// tap or key press; iOS only on touchend/pointerup, not pointerdown, and only keeps playing on the silent ringer with
// navigator.audioSession.type = 'playback'.
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

export const ctx: AudioContext = new (window.AudioContext ?? (window as AudioWindow).webkitAudioContext!)();

const MUTE_KEY = 'ogm.sound';
const VOLUME_KEY = 'ogm.volume';

export function node(dest: AudioNode, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  g.connect(dest);
  return g;
}

export function ramp(g: GainNode, v: number, s: number): void {
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.setTargetAtTime(v, ctx.currentTime, s / 4);
}

let muted = readStored(MUTE_KEY) === 'off';
let volume = Number(readStored(VOLUME_KEY) ?? 1);
if (!Number.isFinite(volume)) volume = 1;

export const master = node(ctx.destination, muted ? 0 : volume);
export const musicBus = node(master, 0.5);
export const trailerBus = node(master, 1);
export const sfxBus = node(master, 0.6);

export type SoundStatus = 'off' | 'on' | 'tap';
const listeners = new Set<(s: SoundStatus) => void>();
export const status = (): SoundStatus => (muted ? 'off' : ctx.state === 'running' ? 'on' : 'tap');
export const isMuted = () => muted;
export const isRunning = () => ctx.state === 'running';
export const onChange = (f: (s: SoundStatus) => void): (() => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
export const notify = () => listeners.forEach((f) => f(status()));

export function unlock(): void {
  try {
    const nav = navigator as AudioSessionNavigator;
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    /* older iOS throws on the setter */
  }
  if (ctx.state === 'running' || document.hidden) return;
  // iOS reports 'interrupted' as well as 'suspended', and older versions only unlock when a sound starts inside the tap
  ctx.resume().then(notify, () => {});
  const s = ctx.createBufferSource();
  s.buffer = ctx.createBuffer(1, 1, 22050);
  s.connect(ctx.destination);
  s.start(0);
}

export function setMuted(m: boolean): void {
  muted = m;
  ramp(master, m ? 0 : volume, 0.2);
  writeStored(MUTE_KEY, m ? 'off' : 'on');
  if (!m) unlock();
  notify();
}

export const getVolume = () => volume;
export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  writeStored(VOLUME_KEY, String(volume));
  if (muted && volume > 0) setMuted(false);
  else {
    ramp(master, muted ? 0 : volume, 0.05);
    notify();
  }
}

for (const ev of ['pointerup', 'touchend', 'keydown', 'click']) {
  window.addEventListener(ev, unlock, { capture: true });
}

// nothing plays in a background tab
let hiddenWhileOn = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenWhileOn = ctx.state === 'running';
    if (hiddenWhileOn) void ctx.suspend();
  } else if (hiddenWhileOn) {
    void ctx.resume();
  }
});

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}
