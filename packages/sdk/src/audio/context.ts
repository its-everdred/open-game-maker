export type BusName = 'music' | 'sfx' | 'amb' | 'voice';
export type AudioBuses = Record<BusName, GainNode>;

export const BUS_GAINS = {
  music: 0.45,
  sfx: 0.8,
  amb: 0.6,
  voice: 1,
} as const satisfies Record<BusName, number>;

type AudioWindow = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

export interface AudioGraph {
  context: AudioContext;
  master: GainNode;
  soundVolume: GainNode;
  musicVolume: GainNode;
  buses: AudioBuses;
}

export function createAudioGraph(win: Window, AudioContextCtor?: typeof AudioContext): AudioGraph {
  const audioWindow = win as AudioWindow;
  const Context = AudioContextCtor ?? audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
  if (!Context) throw new Error('Web Audio is unavailable');

  const context = new Context();
  const master = context.createGain();
  master.connect(context.destination);
  const soundVolume = context.createGain();
  const musicVolume = context.createGain();
  soundVolume.connect(master);
  musicVolume.connect(master);

  const buses = Object.fromEntries(
    Object.entries(BUS_GAINS).map(([name, value]) => {
      const bus = context.createGain();
      bus.gain.value = value;
      bus.connect(name === 'music' ? musicVolume : soundVolume);
      return [name, bus];
    }),
  ) as AudioBuses;

  return { context, master, soundVolume, musicVolume, buses };
}
