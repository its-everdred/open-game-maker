import { trailerTime, type TrailerAudioCapture } from './trailer.js';

/** Observe the public music bus without changing the live graph used by the SDK. */
export function captureMusicBus(
  bus: GainNode,
  context: AudioContext,
  win: Window,
  capture: TrailerAudioCapture,
): GainNode {
  const parameter = bus.gain;
  let value = parameter.value;
  capture.musicGain = value;
  const record = (target: number, timeConstant: number) => {
    if (!Number.isFinite(target) || target < 0 || !Number.isFinite(timeConstant) || timeConstant < 0) {
      capture.unsupported.push('invalid music bus gain');
      return;
    }
    value = target;
    capture.events.push({ type: 'music-gain', timeMs: trailerTime(win, capture), target, timeConstant });
  };
  const gain = new Proxy(parameter, {
    get(target, key) {
      if (key === 'value') return value;
      if (key === 'setTargetAtTime')
        return (next: number, time: number, constant: number) => {
          if (!Number.isFinite(time) || time > context.currentTime + 0.001)
            capture.unsupported.push('scheduled music bus gain');
          else record(next, constant);
          return gain;
        };
      if (
        typeof key === 'string' &&
        /^(setValueAtTime|linearRampToValueAtTime|exponentialRampToValueAtTime|setValueCurveAtTime|cancelScheduledValues|cancelAndHoldAtTime)$/.test(
          key,
        )
      )
        return () => {
          capture.unsupported.push('music bus automation');
          return gain;
        };
      const result: unknown = Reflect.get(target, key, target);
      return typeof result === 'function' ? result.bind(target) : result;
    },
    set(target, key, next) {
      if (key === 'value') {
        record(next as number, 0);
        return true;
      }
      return Reflect.set(target, key, next, target);
    },
  });
  return new Proxy(bus, {
    get(target, key) {
      if (key === 'gain') return gain;
      const result: unknown = Reflect.get(target, key, target);
      return typeof result === 'function' ? result.bind(target) : result;
    },
  });
}
