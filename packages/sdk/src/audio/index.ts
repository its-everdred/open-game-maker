import type { Rng } from '../core/rng.js';
import { createAudioGraph, type AudioBuses, type BusName } from './context.js';
import { MusicPlayer, type MusicOptions } from './music.js';
import { CueRenderer, type CueMetrics, type RenderOptions } from './render.js';
import { AudioRelay, type AudioBridge } from './relay.js';
import { SampleBank, SamplePlayer, type AudioHandle, type AudioLoader, type PlayOptions } from './samples.js';
import { SongPlayer, type SongHandle, type ToneLoader } from './song.js';
import { attachSpokenTextRuntime } from './spoken-text.js';
import { AudioUnlock, type AudioStatus } from './unlock.js';
import { ZzfxPlayer, type ZzfxOptions } from './zzfx.js';

export { songSchema, type Song } from './song.schema.js';
export { SpokenText, type SpokenTextEntry, type SpokenTextHandle, type SpokenTextOptions } from './spoken-text.js';
export { groupSentences, splitSentences, type AlignmentSegment, type TimedSentence } from './sentences.js';
export type {
  AudioBridge,
  AudioBuses,
  AudioHandle,
  AudioLoader,
  AudioStatus,
  BusName,
  CueMetrics,
  MusicOptions,
  PlayOptions,
  RenderOptions,
  SongHandle,
  ZzfxOptions,
};

export interface AudioSettings {
  mute: boolean;
  volume: number;
  musicVolume?: number;
}

export interface CreateAudioOptions {
  rng: Pick<Rng, 'next'> | (() => number);
  bridge?: AudioBridge;
  loader?: AudioLoader;
  settings?: AudioSettings;
  resolveUrl?: (id: string) => string;
  fetch?: typeof globalThis.fetch;
  logger?: Pick<Console, 'warn'>;
  win?: Window;
  AudioContextCtor?: typeof AudioContext;
  OfflineAudioContextCtor?: typeof OfflineAudioContext;
  loadTone?: ToneLoader;
}

export interface GmAudio {
  readonly context: AudioContext;
  readonly buses: AudioBuses;
  unlock(): Promise<void>;
  status(): AudioStatus;
  onStatus(callback: (status: AudioStatus) => void): () => void;
  play(id: string, options?: PlayOptions): AudioHandle | null;
  playOneOf(ids: string[], options?: PlayOptions): AudioHandle | null;
  music(id: string | null, options?: MusicOptions): void;
  zzfx(params: number[], options?: ZzfxOptions): void;
  song(json: unknown): Promise<SongHandle>;
  stop(): void;
  applySettings(settings: AudioSettings): void;
  renderCue(id: string, options?: RenderOptions): Promise<CueMetrics>;
  relay(enabled: boolean): void;
  dispose(): void;
}

type OfflineAudioWindow = Window & {
  OfflineAudioContext?: typeof OfflineAudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
};

export function createAudio(options: CreateAudioOptions): GmAudio {
  const win = options.win ?? globalThis.window;
  if (!win) throw new Error('createAudio requires a browser Window');
  const graph = createAudioGraph(win, options.AudioContextCtor);
  const rng = options.rng;
  const random = typeof rng === 'function' ? rng : () => rng.next();
  const fetcher = options.fetch ?? win.fetch?.bind(win) ?? globalThis.fetch;
  if (!fetcher) throw new Error('createAudio requires fetch when no audio loader is supplied');

  let settings = normalizeSettings(options.settings ?? { mute: false, volume: 1 });
  graph.master.gain.value = settings.mute ? 0 : 1;
  graph.musicVolume.gain.value = settings.musicVolume ?? 1;
  graph.soundVolume.gain.value = settings.volume;

  const relay = new AudioRelay(options.bridge);
  const resolveUrl = options.resolveUrl ?? ((id: string) => id);
  const bank = new SampleBank({
    context: graph.context,
    loader: options.loader,
    fetch: fetcher,
    resolveUrl,
    logger: options.logger ?? console,
  });
  const samples = new SamplePlayer(graph.context, graph.buses, bank, random);
  const music = new MusicPlayer(graph.context, graph.buses.music, bank);
  const effects = new ZzfxPlayer(graph.context, graph.buses, random);
  const songs = new SongPlayer(
    graph.context,
    graph.buses.music,
    options.loadTone ?? (() => import('tone')),
    resolveUrl,
  );
  const audioWindow = win as OfflineAudioWindow;
  const OfflineContext =
    options.OfflineAudioContextCtor ?? audioWindow.OfflineAudioContext ?? audioWindow.webkitOfflineAudioContext;
  const renderer = OfflineContext ? new CueRenderer(bank, OfflineContext) : null;
  const unlock = new AudioUnlock({
    context: graph.context,
    win,
    isMuted: () => settings.mute,
    onRunning: () => {
      if (!relay.enabled) music.replay();
    },
  });
  let disposed = false;
  let detachSpokenText = () => {};

  const stopLocal = () => {
    samples.stopAll();
    music.stop();
    effects.stopAll();
    songs.stop();
  };
  const applyMaster = () => {
    const gain = relay.enabled || settings.mute ? 0 : 1;
    graph.master.gain.setTargetAtTime(gain, graph.context.currentTime, 0.05);
  };
  const play = (id: string, playOptions: PlayOptions = {}): AudioHandle | null => {
    const { vol = 1, rate = 1 } = playOptions;
    if (relay.play(id, vol, rate)) return { stop() {} };
    return samples.play(id, playOptions);
  };

  const audio: GmAudio = {
    context: graph.context,
    buses: graph.buses,
    unlock: unlock.unlock,
    status: () => unlock.status(),
    onStatus: (callback) => unlock.onStatus(callback),
    play,
    playOneOf: (ids, playOptions = {}) => {
      if (ids.length === 0) return null;
      const index = Math.min(ids.length - 1, Math.floor(random() * ids.length));
      return play(ids[index]!, playOptions);
    },
    music: (id, musicOptions = {}) => {
      if (!relay.music(id, musicOptions.vol ?? 1)) music.play(id, musicOptions);
    },
    zzfx: (params, effectOptions) => {
      if (!relay.enabled) effects.play(params, effectOptions);
    },
    song: (json) => songs.play(json),
    stop: () => {
      relay.music(null, 0);
      stopLocal();
    },
    applySettings: (next) => {
      settings = normalizeSettings(next);
      applyMaster();
      graph.musicVolume.gain.setTargetAtTime(settings.musicVolume ?? 1, graph.context.currentTime, 0.05);
      graph.soundVolume.gain.setTargetAtTime(settings.volume, graph.context.currentTime, 0.05);
      unlock.refresh();
    },
    renderCue: (id, renderOptions) => {
      if (!renderer) return Promise.reject(new Error('OfflineAudioContext is unavailable'));
      return renderer.render(id, renderOptions);
    },
    relay: (enabled) => {
      if (enabled) stopLocal();
      relay.setEnabled(enabled);
      applyMaster();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      detachSpokenText();
      relay.music(null, 0);
      stopLocal();
      unlock.dispose();
      void graph.context.close();
    },
  };
  detachSpokenText = attachSpokenTextRuntime({
    context: graph.context,
    voice: graph.buses.voice,
    status: () => unlock.status(),
  });
  return audio;
}

function normalizeSettings(settings: AudioSettings): AudioSettings {
  return {
    mute: settings.mute,
    volume: Math.max(0, Math.min(1, settings.volume)),
    musicVolume: Math.max(0, Math.min(1, settings.musicVolume ?? settings.volume)),
  };
}
