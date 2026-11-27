import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AiurComposer as ComposerElement } from '@aiur/conversation';
import { AiurComposer } from './AiurComposer';

const fake = vi.hoisted(() => ({
  listeners: new Map<string, Set<(value: unknown) => void>>(),
  end: vi.fn(),
  sendText: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  defaultUpload: vi.fn(),
}));
vi.mock('./attachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./attachments')>()),
  uploadChatAttachment: fake.defaultUpload,
}));
vi.mock('@ogm/voice-client', () => ({
  Dictation: class {
    static isSupported() {
      return true;
    }
    on(name: string, callback: (value: unknown) => void) {
      const listeners = fake.listeners.get(name) ?? new Set();
      listeners.add(callback);
      fake.listeners.set(name, listeners);
      return () => listeners.delete(callback);
    }
    pressStart() {}
    pressEnd() {}
    cancel() {}
  },
  VoiceClient: class {
    on(name: string, callback: (value: unknown) => void) {
      const key = `voice:${name}`;
      const listeners = fake.listeners.get(key) ?? new Set();
      listeners.add(callback);
      fake.listeners.set(key, listeners);
      return () => listeners.delete(callback);
    }
    startFromGesture = fake.start;
    end = fake.end;
    sendText = fake.sendText;
  },
}));
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

function emit(name: string, value: unknown) {
  for (const listener of fake.listeners.get(name) ?? []) listener(value);
}

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
  const session = await composer.adapters.dictation!.start({ onPartial: vi.fn(), onLevel: vi.fn() });
  emit('error', { message: 'Microphone denied' });
  await expect(session.stop()).rejects.toThrow('Microphone denied');
});

it('carries opening text into voice and keeps the session when the job refreshes', async () => {
  fake.end.mockClear();
  fake.sendText.mockClear();
  const postText = vi.fn();
  const { container, rerender } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={postText} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.voice).toBeDefined());
  await waitFor(() => expect(composer.onSend).toBeTypeOf('function'));
  composer.value = 'Make it brighter';
  await waitFor(async () =>
    expect(await composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: composer.value })).toBeDefined(),
  );
  emit('voice:state', { capabilities: { text: true } });
  await waitFor(() => expect(fake.sendText).toHaveBeenCalledWith('Make it brighter'));
  rerender(<AiurComposer jobId="job-1" voiceTarget={voiceTarget} postText={postText} />);
  expect(fake.end).not.toHaveBeenCalled();
});

it('streams partial dictation into the upstream composer draft', async () => {
  const { container } = render(<AiurComposer jobId="draft" dictationTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const onPartial = vi.fn();
  const session = await composer.adapters.dictation!.start({ onPartial, onLevel: vi.fn() });
  emit('transcript', { kind: 'partial', text: 'start the forest' });
  expect(onPartial).toHaveBeenCalledWith('start the forest');
  session.cancel?.();
  expect(fake.listeners.get('transcript')?.size).toBe(0);
  expect(fake.listeners.get('error')?.size).toBe(0);
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
  await expect(composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' })).rejects.toThrow('already starting');
  finish();
  await first;
  emit('voice:ended', {});
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
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const mic = composer.shadowRoot!.querySelector<HTMLButtonElement>('.mic')!;
  mic.click();
  await waitFor(() => expect(fake.listeners.get('error')?.size).toBeGreaterThan(0));
  emit('error', { code: 'mic_denied', message: 'Microphone permission denied.' });
  composer.shadowRoot!.querySelector<HTMLButtonElement>('.stop')!.click();
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
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.voice).toBeDefined());
  await waitFor(() =>
    expect(composer.adapters.voice!.start({ onEnd: vi.fn(), initialText: '' })).rejects.toThrow('unavailable'),
  );
  composer.dispatchEvent(
    new CustomEvent('aiur-composer-error', {
      detail: { action: 'voice', error: Object.assign(new Error('Voice is unavailable'), { code: 'api_403' }) },
    }),
  );
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
