import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { VoiceClient, VoiceClientOptions } from '@ogm/voice-client';

import { DecisionVoice, DUCKED_VOLUME, speakingClock, useDucking, type DecisionVoiceTarget } from './decision-voice';

const target: DecisionVoiceTarget = {
  kind: 'build',
  game_id: 'g_1',
  job_id: 'j_1',
  ticket: '57',
  creator_id: 'u_1',
  command_id: 'd_hero',
};
const available = vi.fn().mockResolvedValue({
  available: true,
  token: 'vct1.token',
  url: 'wss://voice.example.test',
  expiresAt: '2026-11-08T10:00:00Z',
});

afterEach(cleanup);

function fakeClient() {
  const listeners = new Map<string, (frame: never) => void>();
  const client = {
    on: vi.fn((type: string, listener: (frame: never) => void) => {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    }),
    startFromGesture: vi.fn().mockResolvedValue(undefined),
    end: vi.fn(),
  } as unknown as VoiceClient;
  const emit = (type: string, frame: Record<string, unknown>) =>
    act(() => listeners.get(type)?.({ v: 1, type, ...frame } as never));
  return { client, emit };
}

// 16-bit mono PCM at 16 kHz: 32 000 bytes is one second of the agent talking.
const oneSecond = btoa('\0'.repeat(32_000));

describe('voice inside a decision', () => {
  // Kevin (#597): the voice agent gets the question, its options and the media context. The target names the decision,
  // which is what the API briefs the agent on first.
  it('opens a call about this decision and reports it live', async () => {
    const { client } = fakeClient();
    const created: VoiceClientOptions[] = [];
    const onLive = vi.fn();
    render(
      <DecisionVoice
        target={target}
        onLive={onLive}
        onSpeaking={vi.fn()}
        onHeard={vi.fn()}
        probe={available}
        createVoiceClient={(options) => {
          created.push(options);
          return client;
        }}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Talk about this decision' }));

    await screen.findByRole('button', { name: 'End voice' });
    expect(created).toEqual([{ url: 'wss://voice.example.test', token: 'vct1.token', target }]);
    expect(onLive).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'End voice' }));
    expect(client.end).toHaveBeenCalled();
    expect(onLive).toHaveBeenLastCalledWith(false);
  });

  // Leaving the decision while the token is still on its way must not open a microphone nobody can end.
  it('opens no call when the screen closes before the token arrives', async () => {
    let resolvePress: (value: unknown) => void = () => undefined;
    const probe = vi
      .fn()
      .mockImplementationOnce(() => available())
      .mockImplementationOnce(() => new Promise((resolve) => (resolvePress = resolve)));
    const createVoiceClient = vi.fn();
    const view = render(
      <DecisionVoice
        target={target}
        onLive={vi.fn()}
        onSpeaking={vi.fn()}
        onHeard={vi.fn()}
        probe={probe}
        createVoiceClient={createVoiceClient}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Talk about this decision' }));
    view.unmount();
    await act(async () => resolvePress(await available()));

    expect(createVoiceClient).not.toHaveBeenCalled();
  });

  // The button is optional: where voice is not configured there is no dead control over the decision.
  it('shows no button where voice is unavailable', async () => {
    const probe = vi.fn().mockResolvedValue({ available: false });
    render(<DecisionVoice target={target} onLive={vi.fn()} onSpeaking={vi.fn()} onHeard={vi.fn()} probe={probe} />);

    await waitFor(() => expect(probe).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
  });

  // A spoken choice is saved by the agent; the screen learns of it by reading the Commands again after each turn.
  it('asks the screen to reread the decision after each final turn, and ducks while the agent talks', async () => {
    const { client, emit } = fakeClient();
    const onHeard = vi.fn();
    const onSpeaking = vi.fn();
    render(
      <DecisionVoice
        target={target}
        onLive={vi.fn()}
        onSpeaking={onSpeaking}
        onHeard={onHeard}
        probe={available}
        createVoiceClient={() => client}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Talk about this decision' }));
    await screen.findByRole('button', { name: 'End voice' });

    emit('transcript', { kind: 'partial', text: 'the kni' });
    expect(onHeard).not.toHaveBeenCalled();
    emit('transcript', { kind: 'final', text: 'the knight' });
    emit('agent_text', { turn_id: 't1', text: 'Saved: the knight.', final: true });
    expect(onHeard).toHaveBeenCalledTimes(2);

    emit('agent_audio', { turn_id: 't1', format: 'pcm_16000', data_b64: oneSecond });
    expect(onSpeaking).toHaveBeenLastCalledWith(true);
    emit('interrupted', { turn_id: 't1' });
    expect(onSpeaking).toHaveBeenLastCalledWith(false);
  });
});

describe('speaking clock', () => {
  function clock() {
    let now = 0;
    const pending: { at: number; run: () => void }[] = [];
    const timers = {
      now: () => now,
      set: (run: () => void, ms: number) => {
        const entry = { at: now + ms, run };
        pending.push(entry);
        return entry;
      },
      clear: (handle: unknown) => {
        const index = pending.indexOf(handle as (typeof pending)[number]);
        if (index >= 0) pending.splice(index, 1);
      },
    };
    const advance = (ms: number) => {
      now += ms;
      for (const entry of pending.filter(({ at }) => at <= now)) {
        pending.splice(pending.indexOf(entry), 1);
        entry.run();
      }
    };
    return { timers, advance };
  }

  // The sample comes back up only after the agent's queued speech has played out, not when the last chunk arrives.
  it('stays speaking until every queued chunk has played', () => {
    const { timers, advance } = clock();
    const report = vi.fn();
    const speech = speakingClock(report, timers);

    speech.heard('pcm_16000', oneSecond);
    speech.heard('pcm_16000', oneSecond);
    expect(report.mock.calls).toEqual([[true]]);

    advance(1_900);
    expect(report.mock.calls).toEqual([[true]]);
    advance(200);
    expect(report.mock.calls).toEqual([[true], [false]]);
  });

  it('ignores audio it cannot time', () => {
    const report = vi.fn();
    speakingClock(report, clock().timers).heard('mp3_44100', oneSecond);
    expect(report).not.toHaveBeenCalled();
  });
});

describe('ducking', () => {
  function Ducked({ ducked }: { ducked: boolean }) {
    useDucking(ducked);
    return <audio data-testid="sample" />;
  }

  // Test media playback against voice audio: the card's sample plays under the agent, then returns to its own volume.
  it('lowers the samples while ducked and restores their volume after', () => {
    const view = render(<Ducked ducked={false} />);
    const sample = screen.getByTestId('sample') as HTMLAudioElement;
    sample.volume = 0.8;

    view.rerender(<Ducked ducked />);
    expect(sample.volume).toBe(DUCKED_VOLUME);

    // A sample that starts while ducked (the next card) is lowered too.
    const next = document.createElement('video');
    next.volume = 1;
    document.body.append(next);
    next.dispatchEvent(new Event('play'));
    expect(next.volume).toBe(DUCKED_VOLUME);

    view.rerender(<Ducked ducked={false} />);
    expect(sample.volume).toBe(0.8);
    expect(next.volume).toBe(1);
    next.remove();
  });
});
