import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dictation, type DictationError, type DictationTranscript, type VoiceClient } from '@ogm/voice-client';

import { Composer, type DictationPort } from './Composer';

class FakeDictation implements DictationPort {
  transcriptListeners: Array<(value: DictationTranscript) => void> = [];
  errorListeners: Array<(value: DictationError) => void> = [];
  pressStart = vi.fn();
  pressEnd = vi.fn();
  cancel = vi.fn();
  on(event: 'transcript', listener: (value: DictationTranscript) => void): () => void;
  on(event: 'error', listener: (value: DictationError) => void): () => void;
  on(
    event: 'transcript' | 'error',
    listener: ((value: DictationTranscript) => void) | ((value: DictationError) => void),
  ) {
    if (event === 'transcript') {
      this.transcriptListeners.push(listener as (value: DictationTranscript) => void);
    } else {
      this.errorListeners.push(listener as (value: DictationError) => void);
    }
    return () => undefined;
  }
  finish(text: string) {
    for (const listener of this.transcriptListeners) listener({ kind: 'final', text });
  }
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Composer', () => {
  it('keeps a dictated final transcript for review until Send', async () => {
    const dictation = new FakeDictation();
    const postText = vi.fn().mockResolvedValue({ id: 'm_1' });
    render(
      <Composer
        jobId="j_1"
        dictation={dictation}
        postText={postText}
        probeVoice={vi.fn().mockResolvedValue({ available: false })}
      />,
    );

    const dictate = screen.getByRole('button', { name: 'Hold to talk' });
    expect(dictate).toHaveTextContent('');
    fireEvent.pointerDown(dictate);
    expect(screen.getByRole('status')).toHaveTextContent('Dictation uses ElevenLabs transcription credits.');
    act(() => dictation.finish('make the door red'));

    expect(screen.getByRole('textbox')).toHaveValue('make the door red');
    expect(screen.getByRole('textbox')).not.toHaveAttribute('placeholder');
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
    expect(postText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(postText).toHaveBeenCalledWith('j_1', 'make the door red');
  });

  it('hides two-way voice when probing reports unavailable', async () => {
    render(
      <Composer
        jobId="j_1"
        dictation={new FakeDictation()}
        postText={vi.fn()}
        probeVoice={vi.fn().mockResolvedValue({ available: false })}
      />,
    );

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start voice chat' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeVisible();
  });

  it('cancels dictation on pointer cancellation and unmount', () => {
    const dictation = new FakeDictation();
    const view = render(
      <Composer
        jobId="j_1"
        dictation={dictation}
        postText={vi.fn()}
        probeVoice={vi.fn().mockResolvedValue({ available: false })}
      />,
    );

    fireEvent.pointerCancel(screen.getByRole('button', { name: 'Hold to talk' }));
    expect(dictation.cancel).toHaveBeenCalledOnce();
    expect(dictation.pressEnd).not.toHaveBeenCalled();
    view.unmount();
    expect(dictation.cancel).toHaveBeenCalledTimes(2);
  });

  it('rolls back an optimistic row and restores text when posting fails', async () => {
    const onOptimistic = vi.fn();
    const onFailed = vi.fn();
    render(
      <Composer
        jobId="j_1"
        dictation={new FakeDictation()}
        postText={vi.fn().mockRejectedValue(new Error('offline'))}
        probeVoice={vi.fn().mockResolvedValue({ available: false })}
        onOptimistic={onOptimistic}
        onFailed={onFailed}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'keep the bridge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(onOptimistic.mock.calls[0][0].id));
    expect(screen.getByRole('textbox')).toHaveValue('keep the bridge');
    expect(screen.getByRole('status')).toHaveTextContent('Message not sent');
  });

  it('allows only one pending post', async () => {
    let resolvePost: (value: unknown) => void = () => undefined;
    const postText = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    render(
      <Composer
        jobId="j_1"
        dictation={new FakeDictation()}
        postText={postText}
        probeVoice={vi.fn().mockResolvedValue({ available: false })}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'one message' } });
    const send = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(send);
    fireEvent.click(send);

    expect(postText).toHaveBeenCalledOnce();
    expect(send).toBeDisabled();
    await act(async () => {
      resolvePost({ id: 'm_1' });
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next message' } });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    expect(postText).toHaveBeenCalledTimes(2);
  });

  it('allows only one pending voice start', async () => {
    let resolveStart: () => void = () => undefined;
    const startFromGesture = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const createVoiceClient = vi.fn(
      () =>
        ({
          on: vi.fn(() => () => undefined),
          startFromGesture,
          end: vi.fn(),
        }) as unknown as VoiceClient,
    );
    render(
      <Composer
        jobId="j_1"
        voiceTarget={{ kind: 'build', game_id: 'g_1', job_id: 'j_1', ticket: '57', creator_id: 'u_1' }}
        dictation={new FakeDictation()}
        postText={vi.fn()}
        probeVoice={vi.fn().mockResolvedValue({
          available: true,
          token: 'token',
          url: 'wss://voice.example.test',
          expiresAt: '2026-11-01T10:00:00Z',
        })}
        createVoiceClient={createVoiceClient}
      />,
    );

    const start = await screen.findByRole('button', { name: 'Start voice chat' });
    fireEvent.click(start);
    fireEvent.click(start);

    expect(screen.getByRole('status')).toHaveTextContent('Voice chat uses ElevenLabs conversational-AI credits.');
    expect(createVoiceClient).toHaveBeenCalledOnce();
    expect(startFromGesture).toHaveBeenCalledOnce();
    expect(start).toBeDisabled();
    await act(async () => resolveStart());
  });

  it('rebinds dictation and voice availability when the target changes', async () => {
    vi.spyOn(Dictation, 'isSupported').mockReturnValue(true);
    const connectDictation = vi.fn(() => new Promise<never>(() => undefined));
    const secondProbe = new Promise<{ available: false }>(() => undefined);
    const probeVoice = vi
      .fn()
      .mockResolvedValueOnce({
        available: true,
        token: 'token-a',
        url: 'wss://voice.example.test',
        expiresAt: '2026-11-03T22:00:00Z',
      })
      .mockReturnValueOnce(secondProbe);
    const targetA = { kind: 'build' as const, game_id: 'g_1', job_id: 'j_1', ticket: '57', creator_id: 'u_1' };
    const targetB = { kind: 'build' as const, game_id: 'g_1', job_id: 'j_2', ticket: '58', creator_id: 'u_1' };
    const { rerender } = render(
      <Composer
        jobId="j_1"
        voiceTarget={targetA}
        postText={vi.fn()}
        probeVoice={probeVoice}
        connectDictation={connectDictation}
      />,
    );

    await screen.findByRole('button', { name: 'Start voice chat' });
    rerender(
      <Composer
        jobId="j_2"
        voiceTarget={targetB}
        postText={vi.fn()}
        probeVoice={probeVoice}
        connectDictation={connectDictation}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Start voice chat' })).not.toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
    await waitFor(() => expect(connectDictation).toHaveBeenCalledWith(targetB));
  });

  it('returns to typing when the voice host ends the call', async () => {
    const listeners = new Map<string, (frame: never) => void>();
    const client = {
      on: vi.fn((type: string, listener: (frame: never) => void) => {
        listeners.set(type, listener);
        return () => listeners.delete(type);
      }),
      startFromGesture: vi.fn().mockResolvedValue(undefined),
      end: vi.fn(),
    } as unknown as VoiceClient;
    render(
      <Composer
        jobId="j_1"
        voiceTarget={{ kind: 'build', game_id: 'g_1', job_id: 'j_1', ticket: '57', creator_id: 'u_1' }}
        dictation={new FakeDictation()}
        postText={vi.fn()}
        probeVoice={vi.fn().mockResolvedValue({
          available: true,
          token: 'token',
          url: 'wss://voice.example.test',
          expiresAt: '2026-11-03T22:00:00Z',
        })}
        createVoiceClient={() => client}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start voice chat' }));
    await screen.findByRole('region', { name: 'Voice chat' });
    act(() => listeners.get('ended')?.({ v: 1, type: 'ended', reason: 'agent_end' } as never));

    await waitFor(() => expect(screen.getByRole('textbox')).toBeVisible());
  });
});
