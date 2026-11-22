import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectDictation, probeVoice, type BuildVoiceTarget } from './voice';

const target: BuildVoiceTarget = {
  kind: 'build',
  game_id: 'g_1',
  job_id: 'j_1',
  ticket: '57',
  creator_id: 'u_1',
};

afterEach(() => vi.unstubAllGlobals());

describe('probeVoice', () => {
  it('maps the wire expiry field to the client shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            token: 'voice-token',
            url: 'wss://voice.example.test',
            expires_at: '2026-11-01T10:00:00Z',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(probeVoice(target)).resolves.toEqual({
      available: true,
      token: 'voice-token',
      url: 'wss://voice.example.test',
      expiresAt: '2026-11-01T10:00:00Z',
    });
  });

  it('treats a 503 token probe as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await expect(probeVoice(target)).resolves.toEqual({ available: false, code: 'api_503' });
  });
});

describe('connectDictation', () => {
  it('requests a fresh dictate-scoped connection for the target', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: 'dictate-token',
          url: 'wss://voice.example.test?mode=dictate',
          expires_at: '2026-11-01T10:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(connectDictation(target)).resolves.toMatchObject({
      token: 'dictate-token',
      url: 'wss://voice.example.test?mode=dictate',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/voice/dictation-token',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ target }) }),
    );
  });
});
