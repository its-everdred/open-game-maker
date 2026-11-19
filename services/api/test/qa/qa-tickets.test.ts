import { describe, expect, it } from 'vitest';
import type { AiurClient } from '@ogm/aiur-client';

import { createQaAiurClient, withQaAiur } from '../../src/qa/aiur.js';
import { INTERNAL_TOKEN, makeApp, makeDeps } from '../helpers.js';

const b64 = (text: string) => Buffer.from(text).toString('base64');
const MEDIA = { still: b64('qa-still'), clip: b64('qa-clip'), audio: b64('qa-audio') };

// The QA account's ticket-detail E2E (#873) taps a running and a closed ticket in the hammer panel. Both must reach the
// panel through the real workers, completed and detail routes, with media the browser can load.
async function qaApp() {
  const deps = makeDeps();
  const real = async (): Promise<AiurClient> => {
    throw new Error('real aiur reached');
  };
  deps.aiurClientForGame = withQaAiur(
    deps.db,
    createQaAiurClient(deps.db, () => deps.blobStore),
    real,
  );
  const { app } = await makeApp(deps);
  const internal = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-ogm-internal': INTERNAL_TOKEN, ...init.headers },
    });
  const session = (await (
    await internal('/internal/qa/session', { method: 'POST', body: JSON.stringify({ email: 'qa@example.test' }) })
  ).json()) as { gameId: string; cookie: { name: string; value: string } };
  const user = (path: string) =>
    app.request(`/api/v1/games/${session.gameId}${path}`, {
      headers: { cookie: `${session.cookie.name}=${session.cookie.value}` },
    });
  return { deps, internal, user };
}

describe('QA ticket fixtures (#873)', () => {
  it('exposes the voice build through the hammer until its run is deleted', async () => {
    const { internal, user } = await qaApp();
    await internal('/internal/qa/voice-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'voice-1' }),
    });
    const workers = (await (await user('/workers')).json()) as { workers: { ticket: string; title: string }[] };
    expect(workers.workers).toContainEqual(expect.objectContaining({ ticket: '879', title: 'QA voice' }));
    const detail = await user('/tickets/879/detail');
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual(expect.objectContaining({ title: 'QA voice' }));
    await internal('/internal/qa/ticket-fixtures', { method: 'DELETE' });
    expect((await user('/tickets/879/detail')).status).toBe(200);
    await internal('/internal/qa/voice-fixtures/old-run', { method: 'DELETE' });
    expect((await user('/tickets/879/detail')).status).toBe(200);
    await internal('/internal/qa/voice-fixtures/voice-1', { method: 'DELETE' });
    expect(((await (await user('/workers')).json()) as { workers: unknown[] }).workers).toEqual([]);
    expect((await user('/tickets/879/detail')).status).toBe(404);
  });
  it('lists a running and a closed ticket whose details open with loadable media, and deletes them', async () => {
    const { deps, internal, user } = await qaApp();
    const seeded = await internal('/internal/qa/ticket-fixtures', {
      method: 'POST',
      body: JSON.stringify({ run: 'run-1', media: MEDIA }),
    });
    expect(seeded.status).toBe(201);
    const { running, closed } = (await seeded.json()) as { running: string; closed: string };

    const workers = (await (await user('/workers')).json()) as { workers: { ticket: string }[] };
    expect(workers.workers.map((worker) => worker.ticket)).toEqual([running]);
    const completed = (await (await user('/tickets/completed')).json()) as { tickets: { ticket: string }[] };
    expect(completed.tickets.map((ticket) => ticket.ticket)).toEqual([closed]);

    for (const ticket of [running, closed]) {
      const response = await user(`/tickets/${ticket}/detail`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { summary: string; media: { kind: string; url: string }[] };
      expect(body.summary).toMatch(/^QA:/);
      expect(body.media.map((item) => item.kind)).toEqual(['image', 'video', 'audio']);
      const hash = `sha256:${body.media[0]!.url.split('/blobs/sha256/')[1]!.split('?')[0]}` as const;
      expect((await deps.blobStore.open(hash))?.ref.mime).toBe('image/png');
    }

    expect((await internal('/internal/qa/ticket-fixtures/run-1', { method: 'DELETE' })).status).toBe(200);
    expect(((await (await user('/workers')).json()) as { workers: unknown[] }).workers).toEqual([]);
    expect((await user(`/tickets/${closed}/detail`)).status).toBe(404);
  });

  it('refuses the fixture routes without the internal token', async () => {
    const { deps } = await qaApp();
    const { app } = await makeApp(deps);
    const response = await app.request('/internal/qa/ticket-fixtures', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run: 'run-1', media: MEDIA }),
    });
    expect(response.status).toBe(401);
  });
});
