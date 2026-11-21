import { AiurHttpError, AiurUnavailableError, type AiurClient, type TicketDetail } from '@ogm/aiur-client';
import { schema } from '@ogm/db';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aiurMediaTiming } from '../../src/commands/aiur-media.js';
import { MAX_DETAIL_COPIES } from '../../src/worker-progress/detail.js';

import type { TrackerTicket } from '../../src/worker-progress/tracker.js';
import { asUser, installUsers, makeApp, makeDeps } from '../helpers.js';

// Kevin taps a ticket in the hammer panel, running or closed, and sees what it did (#873). The detail comes from the
// game's aiur (aiur-team/aiur#8043) and must only open for the game's own tickets, with media the browser can load
// without an aiur credential.

const ids = {
  family: 'f_87300000-0000-4000-8000-000000000001',
  user: 'u_87300000-0000-4000-8000-000000000001',
  outsider: 'u_87300000-0000-4000-8000-000000000002',
  game: 'g_87300000-0000-4000-8000-000000000001',
};
const AT = '2026-11-17T10:00:00.000Z';

const tracked = (ticket: string, game: string, closed: boolean): TrackerTicket => ({
  ticket,
  title: `Ticket ${ticket}`,
  labels: [`game:${game}`],
  closedAt: closed ? AT : null,
  updatedAt: AT,
  outcome: 'Completed',
  url: `https://github.com/fixture/shared/issues/${ticket}`,
});

const detail = (identifier: string): TicketDetail => ({
  identifier,
  title: 'Trailer round 2',
  url: `https://github.com/fixture/shared/issues/${identifier}`,
  state: 'closed',
  status: 'done',
  phase: 'playtesting_and_verification',
  summary: { text: 'Round 2 trailer merged and the creator approved it.' },
  pr: { number: 666, url: 'https://github.com/fixture/shared/pull/666', state: 'merged', ci: { state: 'passed' } },
  live: { running: false },
  media: [
    {
      id: 'm_clip',
      kind: 'video',
      mime: 'video/mp4',
      caption: '23 s cut',
      url: `/api/v1/tickets/${identifier}/media/m_clip?sig=1`,
    },
    { id: 'm_log', kind: 'text', url: `/api/v1/tickets/${identifier}/media/m_log?sig=1` },
  ],
  timeline: [
    { at: AT, kind: 'pr_merged', round: 2, detail: { pr_number: 666 } },
    { at: AT, kind: 'creator_verdict', round: 2, label: 'Needs changes', detail: { quote: 'trailers should loop' } },
  ],
});

async function setup(read: (id: string) => Promise<TicketDetail>) {
  const deps = makeDeps();
  deps.db.insert(schema.families).values({ id: ids.family, name: 'F', ownerUserId: ids.user, createdAt: AT }).run();
  deps.db
    .insert(schema.familyMembers)
    .values({ familyId: ids.family, userId: ids.user, role: 'owner', capability: 'creator', joinedAt: AT })
    .run();
  deps.db
    .insert(schema.games)
    .values({
      id: ids.game,
      familyId: ids.family,
      ownerId: ids.user,
      title: 'Blobs',
      slug: 'blobs',
      githubOwner: 'fixture',
      githubRepo: 'shared',
      visibility: 'private',
      repoVisibility: 'private',
      createdAt: AT,
    })
    .run();
  installUsers(deps, [
    {
      kind: 'user',
      userId: ids.user,
      familyId: ids.family,
      platformRole: 'none',
      capability: 'creator',
      email: 'a@example.test',
    },
    {
      kind: 'user',
      userId: ids.outsider,
      familyId: 'f_87300000-0000-4000-8000-000000000002',
      platformRole: 'none',
      capability: 'creator',
      email: 'b@example.test',
    },
  ]);
  deps.registry.trackerTickets = async (_repo, state) => ({
    stale: false,
    tickets:
      state === 'open' ? [tracked('12', 'blobs', false)] : [tracked('11', 'blobs', true), tracked('99', 'other', true)],
  });
  const ticketDetail = vi.fn(read);
  const ticketDetailMedia = vi.fn(async () => ({
    mime: 'video/mp4',
    body: new Response(new Uint8Array([0, 0, 0, 24])).body!,
  }));
  deps.aiurClientForGame = async () =>
    ({ baseUrl: 'http://127.0.0.1:4100', ticketDetail, ticketDetailMedia }) as unknown as AiurClient;
  const { app } = await makeApp(deps);
  const get = (ticket: string, user = ids.user) =>
    app.request(`/api/v1/games/${ids.game}/tickets/${ticket}/detail`, { headers: asUser(user) });
  return { app, deps, get, ticketDetail, ticketDetailMedia };
}

describe('ticket detail route', () => {
  it('shows a closed ticket’s summary, PR, verdict quote and media the browser can load', async () => {
    const { app, deps, get, ticketDetailMedia } = await setup(async (id) => detail(id));
    const response = await get('11');
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as Record<string, unknown> & {
      media: { url: string; kind: string; caption: string }[];
      timeline: { kind: string; quote: string | null }[];
    };
    expect(body).toMatchObject({
      ticket: '11',
      summary: 'Round 2 trailer merged and the creator approved it.',
      status: 'done',
      running: false,
      pr: { number: 666, state: 'merged', ci: 'passed' },
    });
    expect(body.timeline.find((entry) => entry.kind === 'creator_verdict')?.quote).toBe('trailers should loop');
    // Only showable kinds are listed, and each is a signed blob URL, never the daemon's own address.
    expect(body.media.map((item) => [item.kind, item.caption])).toEqual([['video', '23 s cut']]);
    expect(body.media[0]!.url).toContain('/blobs/');
    expect(body.media[0]!.url).not.toContain('127.0.0.1:4100');
    // On the app's own origin, through the API's blob proxy: prod signed the blob host's tailnet address, which the
    // browser refused from the public app, so no detail picture, clip or sound loaded (#875).
    const signed = new URL(body.media[0]!.url);
    expect(signed.origin).toBe(deps.config.appOrigin);
    const served = await app.request(`${signed.pathname}${signed.search}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('video/mp4');
    expect(ticketDetailMedia).toHaveBeenCalledWith('11', '/api/v1/tickets/11/media/m_clip?sig=1', expect.anything());
    const hash = `sha256:${body.media[0]!.url.split('/blobs/sha256/')[1]!.split('?')[0]}` as const;
    expect((await deps.blobStore.open(hash))?.ref.mime).toBe('video/mp4');
  });

  it('opens a running ticket of the game too', async () => {
    const { get } = await setup(async (id) => ({
      ...detail(id),
      state: 'open',
      status: 'working',
      live: { running: true, activity: 'Capturing' },
    }));
    const response = await get('12');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ running: true, activity: 'Capturing', status: 'working' });
  });

  it('refuses another game’s ticket and another family without asking aiur', async () => {
    const { get, ticketDetail } = await setup(async (id) => detail(id));
    expect((await get('99')).status).toBe(404);
    expect((await get('404')).status).toBe(404);
    expect((await get('11', ids.outsider)).status).toBeGreaterThanOrEqual(400);
    expect(ticketDetail).not.toHaveBeenCalled();
  });

  it('says not found when aiur has no detail and unavailable when the daemon is down', async () => {
    const missing = await setup(async () => {
      throw new AiurHttpError(404, 'not_found', 'nope', 'd');
    });
    expect((await missing.get('11')).status).toBe(404);
    const down = await setup(async () => {
      throw new AiurUnavailableError('d', new Error('refused'));
    });
    expect((await down.get('11')).status).toBe(503);
  });

  it('opens a stale-snapshot ticket only when the game owns it or a fresh lookup says so, and fails closed on errors', async () => {
    const stale = await setup(async (id) => detail(id));
    stale.deps.registry.trackerTickets = async () => ({ stale: true, tickets: [tracked('11', 'blobs', true)] });
    stale.deps.registry.trackerTicket = async (_repo, id) => tracked(id, id === '13' ? 'blobs' : 'other', false);
    expect((await stale.get('11')).status).toBe(404);
    expect((await stale.get('13')).status).toBe(200);
    const down = await setup(async (id) => detail(id));
    down.deps.registry.trackerTickets = async () => {
      throw new Error('github down');
    };
    expect((await down.get('11')).status).toBe(503);
    expect(down.ticketDetail).not.toHaveBeenCalled();
  });
});

// A ticket's media is copied from the game's daemon on first view. A slow copy must still reach the open dialog, and
// a ticket with many large clips must not start every copy at once.
describe('ticket detail media copies', () => {
  const timing = { ...aiurMediaTiming };
  afterEach(() => Object.assign(aiurMediaTiming, timing));

  const many = (identifier: string, count: number): TicketDetail => ({
    ...detail(identifier),
    media: Array.from({ length: count }, (_, index) => ({
      id: `m_${index}`,
      kind: 'image',
      mime: 'image/png',
      url: `/api/v1/tickets/${identifier}/media/m_${index}?sig=1`,
    })),
  });

  it('reports a copy that outlasts the wait as pending and lists it on a later read', async () => {
    Object.assign(aiurMediaTiming, { inboxWaitMs: 20 });
    const { get, ticketDetailMedia } = await setup(async (id) => detail(id));
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    ticketDetailMedia.mockImplementation(async () => {
      await gate;
      return { mime: 'video/mp4', body: new Response(new Uint8Array([1])).body! };
    });
    const first = (await (await get('11')).json()) as { media: unknown[]; mediaPending: number };
    expect(first).toMatchObject({ media: [], mediaPending: 1 });
    finish();
    let second!: { media: unknown[]; mediaPending: number };
    await vi.waitFor(async () => {
      second = (await (await get('11')).json()) as { media: unknown[]; mediaPending: number };
      expect(second.mediaPending).toBe(0);
    });
    expect(second.media).toHaveLength(1);
    expect(ticketDetailMedia).toHaveBeenCalledTimes(1);
  });

  it('runs a bounded number of copies at once and leaves a failed one out', async () => {
    Object.assign(aiurMediaTiming, { inboxWaitMs: 20 });
    const { get, ticketDetailMedia } = await setup(async (id) => many(id, 8));
    let running = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    ticketDetailMedia.mockImplementation(async (_ticket, url) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => releases.push(resolve));
      running -= 1;
      if (url.includes('m_0?')) throw new Error('gone');
      return { mime: 'image/png', body: new Response(new Uint8Array([1])).body! };
    });
    expect(((await (await get('11')).json()) as { mediaPending: number }).mediaPending).toBe(8);
    expect(peak).toBe(MAX_DETAIL_COPIES);
    while (ticketDetailMedia.mock.calls.length < 8 || releases.length) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    Object.assign(aiurMediaTiming, { inboxWaitMs: 2_000 });
    const done = (await (await get('11')).json()) as { media: { id: string }[]; mediaPending: number };
    expect(peak).toBe(MAX_DETAIL_COPIES);
    expect(done.mediaPending).toBe(0);
    expect(done.media.map((item) => item.id)).toEqual(['m_1', 'm_2', 'm_3', 'm_4', 'm_5', 'm_6', 'm_7']);
  });
});
