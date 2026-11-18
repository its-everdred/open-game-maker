import { describe, expect, it, vi } from 'vitest';

import { costLine, dictationFailure, elevenLabsUsage, tallyFrames, twoWayFailure } from '../src/qa-voice-e2e.js';

const frame = (value: Record<string, unknown>) => JSON.stringify(value);

describe('voice socket tally (#879)', () => {
  // The two-way check passes only on audio the agent actually streamed back, so the tally must count agent_audio
  // frames and nothing else as reply audio; a state or caption frame alone is not a reply Kevin would hear.
  it('counts the agent audio, final captions and states that crossed the socket', () => {
    const tally = tallyFrames([
      frame({ type: 'state', state: 'connecting' }),
      frame({ type: 'state', state: 'listening' }),
      frame({ type: 'transcript', kind: 'partial', text: 'Hel' }),
      frame({ type: 'transcript', kind: 'final', text: 'Hello, can you hear me?' }),
      frame({ type: 'agent_text', turn_id: 't1', text: 'Yes', final: false }),
      frame({ type: 'agent_text', turn_id: 't1', text: 'Yes, I can.', final: true }),
      frame({ type: 'agent_audio', turn_id: 't1', format: 'pcm_16000', data_b64: 'AAAA' }),
      frame({ type: 'agent_audio', turn_id: 't1', format: 'pcm_16000', data_b64: 'AAAAAAAA' }),
      frame({ type: 'agent_audio', turn_id: 't1', format: 'pcm_16000', data_b64: '' }),
      'not json',
    ]);
    expect(tally).toEqual({
      states: ['connecting', 'listening'],
      finalTranscripts: ['Hello, can you hear me?'],
      agentText: ['Yes, I can.'],
      agentAudioFrames: 2,
      agentAudioBytes: 9,
      errors: [],
    });
  });

  it('keeps the error codes the host sent', () => {
    expect(tallyFrames([frame({ type: 'error', code: 'provider_unavailable' })]).errors).toEqual([
      'provider_unavailable',
    ]);
  });
});

describe('verdicts', () => {
  // One-way passes only when the clip's own words land: an empty box, or text from somewhere else, is a failure.
  it('passes dictation only on the clip’s words', () => {
    expect(dictationFailure('Make the sky blue.')).toBeNull();
    expect(dictationFailure('make the skies Blue')).toBeNull();
    expect(dictationFailure('  ')).toBe('the message box stayed empty after the clip');
    expect(dictationFailure('Hello there')).toMatch(/not the clip's words/);
  });

  const heard = tallyFrames([frame({ type: 'agent_audio', turn_id: 't', format: 'pcm', data_b64: 'AAAA' })]);

  it('passes two-way only when audio came back and a turn is stored in the chat', () => {
    expect(twoWayFailure(heard, [{ actor: 'creator', text: 'Hello, can you hear me?' }])).toBeNull();
    expect(twoWayFailure(tallyFrames([]), [{ actor: 'agent', text: 'Yes' }])).toBe('no agent audio streamed back');
    expect(twoWayFailure(heard, [])).toBe('no transcript was stored in the chat');
    expect(twoWayFailure(heard, [{ actor: 'creator', text: ' ' }])).toBe('no transcript was stored in the chat');
  });

  it('fails two-way when the host reported an error, even with audio', () => {
    const tally = tallyFrames([
      frame({ type: 'agent_audio', turn_id: 't', format: 'pcm', data_b64: 'AAAA' }),
      frame({ type: 'error', code: 'transcript_store_failed' }),
    ]);
    expect(twoWayFailure(tally, [{ actor: 'agent', text: 'Yes' }])).toBe(
      'the voice socket sent errors: transcript_store_failed',
    );
  });
});

describe('cost report', () => {
  it('reads the account’s used characters with the key in the header, never the URL', async () => {
    const fetcher = vi.fn(async () => Response.json({ character_count: 1234, character_limit: 100000 }));
    expect(await elevenLabsUsage('sk-test', fetcher as unknown as typeof fetch)()).toBe(1234);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/user/subscription');
    expect(url).not.toContain('sk-test');
    expect(init.headers).toEqual({ 'xi-api-key': 'sk-test' });
  });

  it('reports unknown rather than a wrong number when the usage cannot be read', async () => {
    const refused = vi.fn(async () => new Response('', { status: 401 }));
    expect(await elevenLabsUsage('sk-test', refused as unknown as typeof fetch)()).toBeNull();
    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await elevenLabsUsage('sk-test', down as unknown as typeof fetch)()).toBeNull();
    expect(costLine({ characters: null, audioSentSeconds: 3.23, callSeconds: 9 })).toBe(
      'cost elevenlabs characters=unknown minutes=0.15 audio_sent_s=3.2 call_s=9.0',
    );
    expect(costLine({ characters: 41, audioSentSeconds: 3.2, callSeconds: 12 })).toContain('characters=41');
  });
});
