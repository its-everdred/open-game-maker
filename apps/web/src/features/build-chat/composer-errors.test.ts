import { VoiceClientError } from '@ogm/voice-client';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { codedError, describeComposerError } from './composer-errors';

describe('describeComposerError', () => {
  it.each([
    ['dictation', codedError('mic_denied', 'Microphone permission denied.'), 'Microphone blocked.', 'mic_denied'],
    ['voice', new VoiceClientError('mic_denied', 'Microphone permission denied.'), 'Microphone blocked.', 'mic_denied'],
    [
      'dictation',
      codedError('token_error', 'Dictation could not be authorized (ApiError 403).'),
      'Voice unavailable.',
      'token_error',
    ],
    ['voice', codedError('api_403', 'Voice is unavailable'), 'Voice unavailable.', 'api_403'],
    ['voice', codedError('voice_unavailable', 'Voice is unavailable'), 'Voice unavailable.', 'voice_unavailable'],
    [
      'dictation',
      codedError('unsupported', 'Microphone dictation is unavailable.'),
      'Voice unavailable.',
      'unsupported',
    ],
    ['voice', codedError('starting', 'The conversation is starting'), 'Still starting.', 'starting'],
    ['send', codedError('not_sent', 'Message not sent'), 'Message not sent.', 'not_sent'],
    ['send', new ApiError(409, {}), 'Message not sent.', 'api_409'],
    ['upload', new Error('Unsupported attachment'), 'Attachment not added.', 'Error'],
    [
      'voice',
      new VoiceClientError('start_failed', 'Voice session could not start.'),
      'Voice could not start.',
      'start_failed',
    ],
  ] as const)('%s %s', (action, error, text, code) => {
    const failure = describeComposerError({ action, error });
    expect(failure.code).toBe(code);
    expect(failure.text.startsWith(text)).toBe(true);
    expect(failure.text.endsWith(`(${action}: ${code})`)).toBe(true);
  });

  it('tells the creator how to allow the microphone in Safari', () => {
    expect(describeComposerError({ action: 'dictation', error: codedError('mic_denied', 'x') }).text).toMatch(
      /Safari.*Microphone/,
    );
  });

  it('reports a cause by name only, never its message', () => {
    const cause = new DOMException('wss://voice.test/?token=secret', 'SecurityError');
    const failure = describeComposerError({
      action: 'voice',
      error: new VoiceClientError('start_failed', 'Voice session could not start.', { cause }),
    });
    expect(failure.message).toBe('Voice session could not start. (cause SecurityError)');
    expect(failure.message).not.toContain('secret');
  });
});
