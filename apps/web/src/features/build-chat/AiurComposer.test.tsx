import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { AiurComposer as ComposerElement } from '@aiur/conversation';
import { AiurComposer } from './AiurComposer';

const fake = vi.hoisted(() => ({
  listeners: new Map<string, (value: unknown) => void>(),
  end: vi.fn(),
  sendText: vi.fn(),
}));
vi.mock('@ogm/voice-client', () => ({
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
    cancel() {}
  },
  VoiceClient: class {
    on(name: string, callback: (value: unknown) => void) {
      fake.listeners.set(`voice:${name}`, callback);
      return () => fake.listeners.delete(`voice:${name}`);
    }
    startFromGesture() {
      return Promise.resolve();
    }
    end = fake.end;
    sendText = fake.sendText;
  },
}));
vi.mock('./voice', () => ({
  connectDictation: vi.fn(),
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

it('reports microphone errors that arrive before dictation stops', async () => {
  const { container } = render(<AiurComposer jobId="draft" voiceTarget={voiceTarget} postText={vi.fn()} />);
  const composer = container.querySelector('aiur-composer') as ComposerElement;
  await waitFor(() => expect(composer.adapters.dictation).toBeDefined());
  const session = await composer.adapters.dictation!.start();
  fake.listeners.get('error')!({ message: 'Microphone denied' });
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
  await waitFor(async () => expect(await composer.adapters.voice!.start({ onEnd: vi.fn() })).toBeDefined());
  fake.listeners.get('voice:state')!({ capabilities: { text: true } });
  await waitFor(() => expect(fake.sendText).toHaveBeenCalledWith('Make it brighter'));
  rerender(<AiurComposer jobId="job-1" voiceTarget={voiceTarget} postText={postText} />);
  expect(fake.end).not.toHaveBeenCalled();
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
  await expect(composer.adapters.voice!.start({ onEnd: vi.fn() })).rejects.toThrow('conversation is starting');
  finish('job-1');
  await sending;
  await expect(composer.adapters.voice!.start({ onEnd: vi.fn() })).rejects.toThrow('conversation is starting');
});
