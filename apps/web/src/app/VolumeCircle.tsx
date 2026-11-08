import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

import { Icon } from '../components/Icon';
import { MenuRing } from '../components/MenuCircle';
import type { SoundStatus } from '../lib/sound';

const LONG_PRESS_MS = 450;
const DRAG_START_PX = 6;
const FULL_DRAG_PX = 120;
const KEY_STEP = 0.05;

type Gesture = { x: number; y: number; from: number; moved: boolean; held: boolean; timer: number };

// Volume as a circle whose ring is the level: tap mutes, a drag (up or right is louder) sets the level, and a long
// press opens the slider below the row. Arrow keys step the level for keyboards.
export function VolumeCircle({
  sound,
  volume,
  onVolume,
  onMute,
  sliderOpen,
  onSlider,
}: {
  sound: SoundStatus;
  volume: number;
  onVolume(next: number): void;
  onMute(muted: boolean): void;
  sliderOpen: boolean;
  onSlider(): void;
}) {
  const gesture = useRef<Gesture | undefined>(undefined);
  const on = sound === 'on';

  useEffect(() => () => window.clearTimeout(gesture.current?.timer), []);

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    window.clearTimeout(gesture.current?.timer);
    gesture.current = undefined;
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const current: Gesture = { x: event.clientX, y: event.clientY, from: volume, moved: false, held: false, timer: 0 };
    current.timer = window.setTimeout(() => {
      current.held = true;
      onSlider();
    }, LONG_PRESS_MS);
    gesture.current = current;
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (!current || current.held || (event.buttons & 1) === 0) return;
    const up = current.y - event.clientY;
    const right = event.clientX - current.x;
    const distance = Math.abs(up) >= Math.abs(right) ? up : right;
    if (!current.moved && Math.abs(distance) < DRAG_START_PX) return;
    current.moved = true;
    window.clearTimeout(current.timer);
    onVolume(clamp(current.from + distance / FULL_DRAG_PX));
  };
  // Up keeps the gesture for the click that follows; a cancelled press gets no click, so forget it.
  const release = () => window.clearTimeout(gesture.current?.timer);
  const cancel = () => {
    release();
    gesture.current = undefined;
  };
  const click = () => {
    const current = gesture.current;
    gesture.current = undefined;
    if (current?.moved || current?.held) return;
    onMute(on);
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowUp: KEY_STEP, ArrowRight: KEY_STEP, ArrowDown: -KEY_STEP, ArrowLeft: -KEY_STEP }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    onVolume(clamp(volume + step));
  };

  return (
    <button
      type="button"
      className="menu-circle volume-circle"
      aria-label={on ? 'Mute' : 'Unmute'}
      aria-expanded={sliderOpen}
      aria-controls="studio-menu-volume"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={cancel}
      onClick={click}
      onKeyDown={key}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuRing percent={on ? volume * 100 : 0} />
      <Icon name={on ? 'volume' : 'volumeOff'} />
    </button>
  );
}

function clamp(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}
