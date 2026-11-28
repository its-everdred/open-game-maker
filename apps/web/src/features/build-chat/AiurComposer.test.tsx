import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AiurComposer as ComposerElement } from '@aiur/conversation';
import { AiurComposer } from './AiurComposer';

const fake = vi.hoisted(() => ({
  listeners: new Map<string, (value: unknown) => void>(),
  end: vi.fn(),
  sendText: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  dictationMuted: vi.fn(),
  voiceMuted: vi.fn(),
  voiceLevel: undefined as ((level: number) => void) | undefined,
  defaultUpload: vi.fn(),
}));
vi.mock('./attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./attachments')>()),
  uploadChatAttachment: fake.defaultUpload,
}));
vi.mock('@ogm/voice-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ogm/voice-client')>();
  return {
    ...original,
    Dictation: class {
      static isSupported() {
        return true;
      }
      on(name: string, callback: (value: unknown) => void) {
        fake.listeners.set(name, callback);
        return () => fake.listeners.delete(name);
      }
      pressStart() {}
      pressEnd() {}
      setMuted = fake.dictationMuted;
      cancel() {}
    },
    VoiceClient: class {
      constructor(options: { onLevel?: (level: number) => void }) {
        fake.voiceLevel = options.onLevel;
      }
      on(name: string, callback: (value: unknown) => void) {
        fake.listeners.set(`voice:${name}`, callback);
        return () => fake.listeners.delete(`voice:${name}`);
      }
      startFromGesture = fake.start;
      end = fake.end;
      sendText = fake.sendText;
      setMuted = fake.voiceMuted;
    },
  };
});
vi.mock('./voice', () => ({
  connectDictation: vi.fn(),
  voiceProbeFailure: (error: unknown) => ({ available: false, code: String(error) }),
  probeVoice: vi.fn().mockResolvedValue({ available: true, url: 'wss://example.test', token: 'token' }),
}));

const voiceTarget = {
  kind: 'edit' as const,
  game_id: 'game',
  creator_id: 'creator',
  session_id: '29000000-0000-4000-8000-000000000001',
};

it('sends a draft through the host job adapter', async () => {
  const startJob = vi.fn().mockResolvedValue('job-1');
  const postText = vi.fn();
  const { container } = render(<AiurComposer jobId="draft" startJob={startJob} postText={postText} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  composer.value = 'Make it brighter';
  await composer.send();
  expect(startJob).toHaveBeenCalledWith('Make it brighter');
  expect(postText).not.toHaveBeenCalled();
});

it('posts a text instruction separately when admission reused an existing voice job', async () => {
  const startJob = vi.fn().mockResolvedValue('job-1');
  const postText = vi.fn().mockResolvedValue(undefined);
  const { container } = render(
    <AiurComposer jobId="draft" startJob={startJob} postText={postText} wasAdmissionReused={() => true} />,
  );
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  composer.value = 'Add a bridge';
  await composer.send();
  expect(postText).toHaveBeenCalledWith('job-1', 'Add a bridge', undefined);
});

it('uses a custom attachment uploader instead of the default uploader', async () => {
  fake.defaultUpload.mockReset();
  const file = new File(['hello'], 'note.txt', { type: 'text/plain' });
  const uploaded = {
    id: 'attachment-1',
    kind: 'text' as const,
    name: file.name,
    mime: 'text/plain' as const,
    bytes: 5,
  };
  const uploadAttachment = vi.fn().mockResolvedValue(uploaded);
  const postText = vi.fn().mockResolvedValue(undefined);
  const onOptimistic = vi.fn();
  const { container, rerender } = render(
    <AiurComposer jobId="job-1" postText={postText} uploadAttachment={uploadAttachment} onOptimistic={onOptimistic} />,
  );
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  await composer.onSend!('', [{ name: file.name, file }]);
  expect(uploadAttachment).toHaveBeenCalledWith('job-1', file, 'text/plain');
  expect(fake.defaultUpload).not.toHaveBeenCalled();
  expect(postText).toHaveBeenCalledWith('job-1', '', ['attachment-1']);
  expect(onOptimistic.mock.calls[0][0].attachments).toEqual([
    { id: expect.stringMatching(/^optimistic-/), kind: 'text', name: 'note.txt', mime: 'text/plain', bytes: 5 },
  ]);
  fake.defaultUpload.mockResolvedValue({
    id: 'attachment-2',
    kind: 'text',
    name: file.name,
    mime: 'text/plain',
    bytes: 5,
  });
  rerender(<AiurComposer jobId="job-1" postText={postText} onOptimistic={onOptimistic} />);
  await composer.onSend!('', [{ name: file.name, file }]);
  expect(fake.defaultUpload).toHaveBeenCalledWith('job-1', file, 'text/plain');
  expect(postText).toHaveBeenCalledWith('job-1', '', ['attachment-2']);
});

it('emits an optimistic message before the post resolves', async () => {
  let resolvePost: (value: undefined) => void = () => {};
  const postText = vi.fn(
    () =>
      new Promise<undefined>((resolve) => {
        resolvePost = resolve;
      }),
  );
  const onOptimistic = vi.fn();
  const { container } = render(<AiurComposer jobId="job-1" postText={postText} onOptimistic={onOptimistic} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  composer.value = 'Make it brighter';
  const sending = composer.send();
  await waitFor(() => expect(postText).toHaveBeenCalledWith('job-1', 'Make it brighter', undefined));
  expect(onOptimistic).toHaveBeenCalledOnce();
  expect(onOptimistic.mock.calls[0][0]).toMatchObject({
    job_id: 'job-1',
    actor: 'creator',
    text: 'Make it brighter',
    optimistic: true,
  });
  resolvePost(undefined);
  await sending;
});

it('reports the optimistic message id when posting rejects', async () => {
  const postText = vi.fn().mockRejectedValue(new Error('post failed'));
  const onOptimistic = vi.fn();
  const onFailed = vi.fn();
  const { container } = render(
    <AiurComposer jobId="job-1" postText={postText} onOptimistic={onOptimistic} onFailed={onFailed} />,
  );
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  composer.value = 'Make it brighter';
  const sent = await composer.send();
  expect(sent).toBe(false);
  expect(onFailed).toHaveBeenCalledWith(onOptimistic.mock.calls[0][0].id);
  expect(composer.value).toBe('Make it brighter');
});

it('reports microphone errors that arrive before dictation stops', async () => {
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const onPartial = vi.fn();
  const session = await composer.adapters.dictation!.start({ onPartial, onLevel: vi.fn() });
  fake.listeners.get('transcript')!({ kind: 'partial', text: 'Make it' });
  expect(onPartial).toHaveBeenCalledWith('Make it');
  fake.listeners.get('error')!({ message: 'Microphone denied' });
  await expect(session.stop()).rejects.toThrow('Microphone denied');
});

it('keeps an unconfirmed dictation from being sent or passed to voice until edited', async () => {
  const postText = vi.fn().mockResolvedValue(undefined);
  const { container } = render(<AiurComposer jobId="job-1" voiceTarget={voiceTarget} postText={postText} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const session = await composer.adapters.dictation!.start({ onPartial: vi.fn(), onLevel: vi.fn() });
  fake.listeners.get('transcript')!({ kind: 'partial', text: 'partial words' });
  fake.listeners.get('error')!({ code: 'incomplete_transcript', message: 'Final words missing' });
  await expect(session.stop()).rejects.toThrow('Final words missing');
  await expect(composer.onSend!('partial words', [])).rejects.toThrow('Review the dictation');
  await expect(composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: 'partial words' })).rejects.toThrow(
    'Review the dictation',
  );
  expect(postText).not.toHaveBeenCalled();
  composer.shadowRoot!.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
  await composer.onSend!('corrected words', []);
  expect(postText).toHaveBeenCalledWith('job-1', 'corrected words', undefined);
});

it('allows a voice attempt after microphone denial without a transcript', async () => {
  const { container } = render(<AiurComposer jobId="job-1" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const session = await composer.adapters.dictation!.start({ onPartial: vi.fn(), onLevel: vi.fn() });
  fake.listeners.get('error')!({ code: 'mic_denied', message: 'Microphone denied' });
  await expect(session.stop()).rejects.toThrow('Microphone denied');
  await waitFor(async () =>
    expect(await composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' })).toBeDefined(),
  );
});

it('carries opening text into voice and keeps the session when the job refreshes', async () => {
  fake.end.mockClear();
  fake.sendText.mockClear();
  const postText = vi.fn();
  const { container, rerender } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={postText} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.voice).toBeDefined());
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  await waitFor(async () =>
    expect(await composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: 'Make it brighter' })).toBeDefined(),
  );
  fake.listeners.get('voice:state')!({ capabilities: { text: true } });
  await waitFor(() => expect(fake.sendText).toHaveBeenCalledWith('Make it brighter'));
  rerender(<AiurComposer jobId="job-1" voiceTarget={voiceTarget} postText={postText} />);
  expect(fake.end).not.toHaveBeenCalled();
});

it('sends the dictated opening when switching to voice and keeps the end control visible', async () => {
  fake.end.mockClear();
  fake.sendText.mockClear();
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.mic')!.click();
  await waitFor(() => expect(fake.listeners.get('transcript')).toBeDefined());
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.voice')!.click();
  fake.listeners.get('transcript')!({ kind: 'final', text: 'Make it brighter' });
  await waitFor(() => expect(composer.hasAttribute('data-voice-live')).toBe(true));
  fake.listeners.get('voice:state')!({ capabilities: { text: true } });
  expect(fake.sendText).toHaveBeenCalledWith('Make it brighter');
  expect(composer.shadowRoot!.textContent).toContain(':host(:not([data-recording]):not([data-voice-live]))');
  const voiceButton = composer.shadowRoot!.querySelector<HTMLButtonElement>('.voice')!;
  expect(voiceButton.hidden).toBe(false);
  voiceButton.click();
  await waitFor(() => expect(fake.end).toHaveBeenCalled());
});

it('keeps the microphone as a mute control and shows both live voice transcripts', async () => {
  fake.dictationMuted.mockClear();
  fake.voiceMuted.mockClear();
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const mic = composer.shadowRoot!.querySelector<HTMLButtonElement>('[part="mic"]')!;
  const twoWay = composer.shadowRoot!.querySelector<HTMLButtonElement>('[part="voice"]')!;
  expect(twoWay.innerHTML).toContain('fill="var(--blue-b)"');
  mic.click();
  await waitFor(() => expect(composer.hasAttribute('data-recording')).toBe(true));
  await waitFor(() => expect(mic.getAttribute('aria-label')).toBe('Mute microphone'));
  const waveform = composer.shadowRoot!.querySelector<HTMLElement>('[part="waveform"]')!;
  fake.listeners.get('level')!(0.6);
  expect(waveform.hidden).toBe(false);
  expect(waveform.querySelector('i')?.style.transform).not.toBe('scaleY(0.1)');
  expect(mic.hidden).toBe(false);
  expect(mic.style.opacity).toBe('1');

  mic.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, button: 0 }));
  expect(fake.dictationMuted).toHaveBeenCalledWith(true);
  expect(mic.getAttribute('aria-label')).toBe('Unmute microphone');
  expect(mic.style.opacity).toBe('0.58');
  expect(Array.from(waveform.querySelectorAll('i')).every((bar) => bar.style.transform === 'scaleY(0.10)')).toBe(true);

  composer.shadowRoot!.querySelector<HTMLButtonElement>('[part="voice"]')!.click();
  fake.listeners.get('transcript')!({ kind: 'final', text: 'Start run' });
  await waitFor(() => expect(composer.hasAttribute('data-voice-live')).toBe(true));
  await waitFor(() => expect(mic.getAttribute('aria-label')).toBe('Mute microphone'));
  expect(mic.hidden).toBe(false);
  fake.voiceLevel?.(0.8);
  expect(waveform.querySelector('i')?.style.transform).not.toBe('scaleY(0.1)');

  mic.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true, button: 0 }));
  expect(fake.voiceMuted).toHaveBeenCalledWith(true);
  fake.listeners.get('voice:transcript')!({ type: 'transcript', kind: 'final', text: 'Start run' });
  fake.listeners.get('voice:agent_text')!({ type: 'agent_text', turn_id: 'turn-1', text: 'Run started.', final: true });
  await waitFor(() => expect(container.querySelector('[aria-label="Live voice conversation"]')).not.toBeNull());
  expect(container).toHaveTextContent('Start run');
  expect(container).toHaveTextContent('Run started.');
  const transcript = container.querySelector('[aria-label="Live voice conversation"]')!;
  const lines = Array.from(transcript.querySelectorAll('.build-chat-row'));
  expect(lines.map((line) => line.classList.contains('creator'))).toEqual([true, false]);
  expect(lines.map((line) => line.classList.contains('agent'))).toEqual([false, true]);
});

it.each(['Enter', 'Space'])('starts dictation on idle microphone %s and mutes on the next activation', async (code) => {
  fake.dictationMuted.mockClear();
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const mic = composer.shadowRoot!.querySelector<HTMLButtonElement>('[part="mic"]')!;
  mic.focus();
  const activate = () => {
    mic.dispatchEvent(
      new KeyboardEvent('keydown', { key: code === 'Space' ? ' ' : 'Enter', code, bubbles: true, composed: true }),
    );
    mic.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true, composed: true }));
  };

  activate();
  await waitFor(() => expect(composer.hasAttribute('data-recording')).toBe(true));
  expect(fake.dictationMuted).not.toHaveBeenCalled();

  activate();
  expect(fake.dictationMuted).toHaveBeenCalledWith(true);
});

it('restores unsent opening words when voice ends before text is available', async () => {
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.voice).toBeDefined());
  await composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: 'Make it brighter' });
  composer.value = 'and add stars';
  fake.listeners.get('voice:ended')!({});
  expect(composer.value).toBe('Make it brighter and add stars');
});

it('does not start voice after the composer closes during dictation', async () => {
  fake.start.mockClear();
  const { container, unmount } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.mic')!.click();
  await waitFor(() => expect(fake.listeners.get('transcript')).toBeDefined());
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.voice')!.click();
  unmount();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fake.start).not.toHaveBeenCalled();
});

it('does not send a pending dictation after the composer closes', async () => {
  const postText = vi.fn();
  const { container, unmount } = render(<AiurComposer jobId="job-1" voiceTarget={voiceTarget} postText={postText} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  composer.value = 'Do this';
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.mic')!.click();
  await waitFor(() => expect(fake.listeners.get('transcript')).toBeDefined());
  const sending = composer.send();
  unmount();
  await sending;
  expect(postText).not.toHaveBeenCalled();
});

it('unsubscribes dictation listeners on cancellation', async () => {
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const session = await composer.adapters.dictation!.start({ onPartial: vi.fn(), onLevel: vi.fn() });
  session.cancel?.();
  expect(fake.listeners.has('transcript')).toBe(false);
  expect(fake.listeners.has('error')).toBe(false);
});

it('does not start another voice job while text admission is still pending', async () => {
  let finish: (id: string) => void = () => {};
  const startJob = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const { container } = render(
    <AiurComposer jobId="draft" voiceTarget={voiceTarget} startJob={startJob} postText={vi.fn()} />,
  );
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.voice).toBeDefined());
  composer.value = 'Make a bridge';
  const sending = composer.send();
  await waitFor(() => expect(startJob).toHaveBeenCalled());
  await expect(composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' })).rejects.toThrow(
    'conversation is starting',
  );
  finish('job-1');
  await sending;
  await expect(composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' })).rejects.toThrow(
    'conversation is starting',
  );
});

it('rejects a second voice start and allows a new start after a remote end', async () => {
  let finish: () => void = () => {};
  fake.start.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.voice).toBeDefined());
  await waitFor(() => expect(fake.start).toBeDefined());
  const first = composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' });
  const input = composer.shadowRoot!.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(input.readOnly).toBe(true);
  await expect(composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' })).rejects.toThrow('already starting');
  finish();
  await first;
  expect(input.readOnly).toBe(false);
  fake.listeners.get('voice:ended')!({});
  await expect(composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' })).resolves.toBeDefined();
});

function reports(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls
    .filter(([url]) => url === '/api/v1/voice/client-error')
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

it('shows a blocked microphone with the cause and reports it', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  const { container, findByRole } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const mic = composer.shadowRoot!.querySelector<HTMLButtonElement>('.mic')!;
  mic.click();
  await waitFor(() => expect(fake.listeners.get('error')).toBeDefined());
  fake.listeners.get('error')!({ code: 'mic_denied', message: 'Microphone permission denied.' });
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.stop')!.click();
  expect((await findByRole('alert')).textContent).toMatch(/^Microphone blocked\..*\(dictation: mic_denied\)$/);
  await waitFor(() =>
    expect(reports(fetch)).toEqual([
      { action: 'dictation', code: 'mic_denied', message: 'Microphone permission denied.', target_kind: 'edit' },
    ]),
  );
  vi.unstubAllGlobals();
});

it('names a voice start that has no token and reports it', async () => {
  const { probeVoice } = await import('./voice');
  vi.mocked(probeVoice).mockRejectedValueOnce('api_403');
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  const { container, findByRole } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.voice).toBeDefined());
  await waitFor(() =>
    expect(composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' })).rejects.toThrow('unavailable'),
  );
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.mic')!.click();
  await waitFor(() => expect(fake.listeners.get('error')).toBeDefined());
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.voice')!.click();
  fake.listeners.get('transcript')!({ kind: 'final', text: '' });
  expect((await findByRole('alert')).textContent).toBe('Voice unavailable. (voice: api_403)');
  await waitFor(() =>
    expect(reports(fetch)).toEqual([
      { action: 'voice', code: 'api_403', message: 'Voice is unavailable', target_kind: 'edit' },
    ]),
  );
  vi.unstubAllGlobals();
});

it('says a message was not sent when admission fails', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  const { container, findByRole } = render(
    <AiurComposer jobId="draft" startJob={vi.fn().mockResolvedValue(undefined)} postText={vi.fn()} />,
  );
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  composer.value = 'Add a bridge';
  await composer.send();
  expect((await findByRole('alert')).textContent).toBe('Message not sent. (send: not_sent)');
  await waitFor(() =>
    expect(reports(fetch)).toEqual([{ action: 'send', code: 'not_sent', message: 'Message not sent' }]),
  );
  vi.unstubAllGlobals();
});
