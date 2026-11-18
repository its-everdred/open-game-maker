import { describe, expect, it, vi } from 'vitest';

import { AiurConfigError, createAiurClient } from '../src/index.js';

const daemon = { baseUrl: 'http://127.0.0.1:4000', token: 'client-secret', supervisorToken: 'supervisor-secret' };

// The detail shape aiur-team/aiur#8043 publishes, trimmed to what a host reads plus one field it does not.
const detail = {
  identifier: '644',
  title: 'Blobs trailer',
  url: 'https://github.com/owner/blobs/issues/644',
  version: 'sha256:abc',
  state: 'open',
  labels: ['agent:human-review'],
  status: 'waiting_on_creator',
  phase: 'playtesting_and_verification',
  summary: { text: 'Round 2 trailer is merged and waits on your verdict.', source: ['workpad'], as_of: '2026-11-17' },
  pr: { number: 666, url: 'https://github.com/owner/blobs/pull/666', state: 'merged', ci: { state: 'passed' } },
  media: [{ id: 'm_1', kind: 'video', mime: 'video/mp4', url: '/api/v1/tickets/644/media/m_1?exp=1&sig=x' }],
  timeline: [{ at: '2026-11-17T10:00:00Z', kind: 'creator_verdict', label: 'Needs changes', detail: { quote: 'q' } }],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('ticket detail', () => {
  it('reads an open or closed ticket’s detail with the read token and keeps fields aiur adds', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(detail));
    const read = await createAiurClient(daemon, fetchImpl).ticketDetail('644');
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:4000/api/v1/tickets/644/detail');
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get('authorization')).toBe('Bearer client-secret');
    expect(read.summary?.text).toBe(detail.summary.text);
    expect(read.media[0]?.url).toBe(detail.media[0]!.url);
    expect(read).toMatchObject({ version: 'sha256:abc' });
  });

  it('fetches a listed media file from this ticket’s media route', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'video/mp4' } }));
    const file = await createAiurClient(daemon, fetchImpl).ticketDetailMedia('644', detail.media[0]!.url);
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:4000/api/v1/tickets/644/media/m_1?exp=1&sig=x');
    expect(file.mime).toBe('video/mp4');
    expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  // A detail is data from the daemon; its URLs must never make the API fetch another host or another route with the
  // daemon's token.
  it.each([
    'https://elsewhere.example/api/v1/tickets/644/media/m_1',
    '/api/v1/tickets/645/media/m_1',
    '/api/v1/tickets/644/media/..%2F..%2Fstate',
    '/api/v1/tickets/644/media/m_1/../../../state',
    '/api/v1/state',
  ])('refuses a media URL outside this ticket’s media route: %s', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(createAiurClient(daemon, fetchImpl).ticketDetailMedia('644', url)).rejects.toBeInstanceOf(
      AiurConfigError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
