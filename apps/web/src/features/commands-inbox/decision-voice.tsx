import { useEffect, useRef, useState } from 'react';

import type { VoiceTarget } from '@ogm/contracts';
import { VoiceClient, type VoiceClientOptions } from '@ogm/voice-client';

import { Icon } from '../../components/Icon';
import { probeVoice, type VoiceAvailability } from '../build-chat/voice';

// Two-way voice from inside a decision (#597). The voice target names the decision, so the agent is briefed on its
// question, options and cards first. A clear spoken choice is answered by the agent through the same route a click
// takes; the screen sees it land on its next read of the Commands. The button sits in the screen's header, so it never
// covers the cards or the options.
export type DecisionVoiceTarget = Extract<VoiceTarget, { kind: 'build' }>;

// While the agent talks, the deck's own sample plays quieter so both can be heard; the sample comes back to its own
// volume once the agent's queued speech has played out.
export const DUCKED_VOLUME = 0.2;

export function DecisionVoice({
  target,
  onLive,
  onSpeaking,
  onHeard,
  probe = probeVoice,
  createVoiceClient = (options) => new VoiceClient(options),
}: {
  target: DecisionVoiceTarget;
  onLive(live: boolean): void;
  onSpeaking(speaking: boolean): void;
  // A final turn from either side: the agent may have just saved a spoken choice, so the screen rereads the Commands.
  onHeard(): void;
  probe?: (target: VoiceTarget) => Promise<VoiceAvailability>;
  createVoiceClient?: (options: VoiceClientOptions) => VoiceClient;
}) {
  const [client, setClient] = useState<VoiceClient>();
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const clientRef = useRef<VoiceClient | undefined>(undefined);
  const callbacks = useRef({ onLive, onSpeaking, onHeard });
  callbacks.current = { onLive, onSpeaking, onHeard };

  // The button only appears where voice works: the voice host is configured and the target is one the creator may
  // talk to. The token it mints is short-lived, so a press asks for a fresh one.
  const [available, setAvailable] = useState(false);
  const targetKey = JSON.stringify(target);
  useEffect(() => {
    let current = true;
    probe(JSON.parse(targetKey) as DecisionVoiceTarget).then(
      (voice) => {
        if (current) setAvailable(voice.available);
      },
      () => {
        if (current) setAvailable(false);
      },
    );
    return () => {
      current = false;
    };
  }, [probe, targetKey]);

  // Leaving the decision ends the call, including one still starting: a press whose token or microphone arrives after
  // the screen is gone must not open a call nobody can end.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clientRef.current?.end();
      clientRef.current = undefined;
    };
  }, []);

  const stop = (ending: VoiceClient) => {
    if (clientRef.current !== ending) return;
    clientRef.current = undefined;
    setClient(undefined);
    callbacks.current.onSpeaking(false);
    callbacks.current.onLive(false);
  };

  const start = async () => {
    if (starting || clientRef.current) return;
    setStarting(true);
    setNotice('');
    try {
      const voice = await probe(target);
      if (!mounted.current) return;
      if (!voice.available) {
        setNotice('Voice is not available right now.');
        return;
      }
      const created = createVoiceClient({ url: voice.url, token: voice.token, target });
      clientRef.current = created;
      const speech = speakingClock((speaking) => callbacks.current.onSpeaking(speaking));
      created.on('agent_audio', (frame) => speech.heard(frame.format, frame.data_b64));
      created.on('interrupted', () => speech.stop());
      created.on('agent_text', (frame) => {
        if (frame.final) callbacks.current.onHeard();
      });
      created.on('transcript', (frame) => {
        if (frame.kind === 'final') callbacks.current.onHeard();
      });
      created.on('error', (frame) => setNotice(frame.message));
      created.on('ended', () => {
        speech.stop();
        stop(created);
      });
      setNotice('Voice chat uses ElevenLabs conversational-AI credits.');
      await created.startFromGesture();
      if (!mounted.current) {
        created.end();
        return;
      }
      if (clientRef.current !== created) return;
      setClient(created);
      callbacks.current.onLive(true);
    } catch {
      const failed = clientRef.current;
      failed?.end();
      if (failed) stop(failed);
    } finally {
      setStarting(false);
    }
  };

  const live = client !== undefined;
  if (!available && !live) return null;
  return (
    <>
      <button
        aria-label={live ? 'End voice' : 'Talk about this decision'}
        aria-pressed={live}
        className={`review-screen-voice tap-secondary${live ? ' is-live' : ''}`}
        disabled={starting}
        onClick={() => {
          if (client) {
            client.end();
            stop(client);
          } else {
            void start();
          }
        }}
        type="button"
      >
        <Icon name="mic" />
      </button>
      {notice === '' ? null : (
        <p className="sr" role="status">
          {notice}
        </p>
      )}
    </>
  );
}

const PCM_RATES: Record<string, number> = { pcm_16000: 16_000, pcm_24000: 24_000, pcm_44100: 44_100 };

// How long the agent's queued speech still has to play. Each chunk is 16-bit mono PCM, so its bytes say how long it
// runs; chunks queue back to back, so the agent is audible until the last one has played out.
export function speakingClock(
  report: (speaking: boolean) => void,
  timers: { now(): number; set(run: () => void, ms: number): unknown; clear(handle: unknown): void } = {
    now: () => performance.now(),
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
) {
  let until = 0;
  let timer: unknown;
  let speaking = false;
  const quiet = () => {
    timers.clear(timer);
    timer = undefined;
    until = 0;
    if (speaking) {
      speaking = false;
      report(false);
    }
  };
  return {
    heard(format: string, dataB64: string) {
      const rate = PCM_RATES[format];
      if (rate === undefined) return;
      const bytes = Math.floor((dataB64.replace(/=+$/, '').length * 3) / 4);
      const now = timers.now();
      until = Math.max(until, now) + (bytes / 2 / rate) * 1000;
      if (!speaking) {
        speaking = true;
        report(true);
      }
      timers.clear(timer);
      timer = timers.set(quiet, until - now);
    },
    stop: quiet,
  };
}

// Lowers every sample on the page while `ducked`, including one that starts playing later (the next card's sound or
// the full-screen clip), and puts each back to the volume it had. The agent's voice plays through Web Audio, not a
// media element, so it is never ducked itself.
export function useDucking(ducked: boolean, root: Document = document): void {
  useEffect(() => {
    if (!ducked) return;
    const original = new Map<HTMLMediaElement, number>();
    const duck = (element: HTMLMediaElement) => {
      if (original.has(element)) return;
      original.set(element, element.volume);
      element.volume = Math.min(element.volume, DUCKED_VOLUME);
    };
    root.querySelectorAll<HTMLMediaElement>('audio, video').forEach(duck);
    const onPlay = (event: Event) => {
      if (event.target instanceof HTMLMediaElement) duck(event.target);
    };
    root.addEventListener('play', onPlay, true);
    return () => {
      root.removeEventListener('play', onPlay, true);
      for (const [element, volume] of original) element.volume = volume;
    };
  }, [ducked, root]);
}
