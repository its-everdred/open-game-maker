import type { AiurClient } from '@ogm/aiur-client';
import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listSince } from '../../src/build-chat/store.js';
import { writeLimits } from '../../src/energy/store.js';
import { buildBriefing, clearVoiceWaitingOn, type VoiceTarget } from '../../src/voice/briefing-push.js';
import { ids, NOW, worked } from '../budget/fixture.js';
import { makeApp } from '../helpers.js';

const SECRET = 'voice-internal-secret-for-tests';
const defaults = { dailyAllowanceMicroUsd: 5_000_000, resetZone: 'America/Los_Angeles' };
const build: VoiceTarget = {
  kind: 'build',
  game_id: ids.game,
  job_id: ids.running,
  ticket: '7',
  creator_id: ids.creator,
};
const scope: VoiceTarget = {
  kind: 'scope',
  game_id: ids.game,
  session_id: 'session-one',
  creator_id: ids.creator,
};

afterEach(() => {
  clearVoiceWaitingOn(scope);
  vi.restoreAllMocks();
});

async function setup() {
  const deps = worked();
  deps.config.voiceInternalSecret = SECRET;
  deps.db
    .update(schema.jobs)
    .set({ aiurRepo: 'owner/game', aiurIssueNumber: 7 })
    .where(eq(schema.jobs.id, ids.running))
    .run();
  const message = vi.fn().mockResolvedValue({ request_id: 'message-one' });
  deps.aiurClientForGame = async () => ({ message }) as unknown as AiurClient;
  const { app } = await makeApp(deps);
  const request = (target: VoiceTarget, text: string, idempotencyKey = 'voice-one', secret = SECRET) =>
    app.request('/internal/voice/instruct', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ogm-internal': secret },
      body: JSON.stringify({ target, text, idempotency_key: idempotencyKey, kind: 'instruct' }),
    });
  return { deps, message, request };
}

describe('POST /internal/voice/instruct', () => {
  it('posts a build instruction to Aiur and creator chat exactly once', async () => {
    const { deps, message, request } = await setup();

    const first = await request(build, 'Make the door red');
    const replay = await request(build, 'Make the door red');

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ delivery_id: expect.any(String), status: 'delivered' });
    expect(await replay.json()).toEqual({ delivery_id: expect.any(String), status: 'delivered' });
    expect(message).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledWith('7', 'Make the door red', 'voice-one');
    expect(listSince(deps.sqlite, ids.running, 0)).toEqual([
      expect.objectContaining({ actor: 'creator', kind: 'text', text: 'Make the door red', aiurTicket: '7' }),
    ]);
  });

  it('rejects a wrong internal secret before delivery', async () => {
    const { message, request } = await setup();

    const response = await request(build, 'Make the door red', 'voice-wrong-secret', 'wrong');

    expect(response.status).toBe(401);
    expect(message).not.toHaveBeenCalled();
  });

  it('admits a scope draft and strips the later marker into an at-reset job', async () => {
    const { deps, request } = await setup();

    const first = await request(scope, '[later] Add lanterns', 'voice-later');
    const replay = await request(scope, '[later] Add lanterns', 'voice-later');

    expect(await first.json()).toEqual({ delivery_id: expect.any(String), status: 'queued_at_reset' });
    expect(await replay.json()).toEqual({ delivery_id: expect.any(String), status: 'queued_at_reset' });
    const jobs = deps.db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, 'voice:voice-later')).all();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ start: 'at_reset', state: 'queued' });
    expect(JSON.parse(jobs[0].plan)).toMatchObject({ title: 'Add lanterns', summary: 'Add lanterns' });
    const reservation = JSON.parse(jobs[0].reservation) as { amountMicroUsd: number; sizeClass: string };
    expect(reservation).toMatchObject({ amountMicroUsd: 4_000_000, sizeClass: 'medium' });
    expect(deps.db.select().from(schema.budgetLedger).where(eq(schema.budgetLedger.jobId, jobs[0].id)).all()).toEqual([
      expect.objectContaining({
        userId: ids.creator,
        kind: 'reservation',
        amountMicroUsd: reservation.amountMicroUsd,
        dayKey: expect.any(String),
      }),
    ]);
  });

  it('keeps a refused scope draft pending with the four next choices', async () => {
    const { deps, request } = await setup();
    deps.db
      .insert(schema.allowances)
      .values({ familyId: ids.family, userId: ids.creator, dailyMicroUsd: 3_000_000 })
      .run();

    const response = await request(scope, 'Add lanterns', 'voice-over-budget');

    expect(await response.json()).toEqual({ delivery_id: expect.any(String), status: 'needs_choice' });
    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, scope);
    expect(briefing.waiting_on).toBe("Doesn't fit today: trim, split, queue for 12:00 am, or ask an admin");
    expect(
      deps.db.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, 'voice:voice-over-budget')).all(),
    ).toEqual([]);
  });

  it('says which Energy window a refused draft does not fit and offers only what admission offered', async () => {
    const { deps, request } = await setup();
    deps.db.insert(schema.allowances).values({ familyId: ids.family, userId: ids.creator, dailyMicroUsd: 1e9 }).run();
    writeLimits(deps.db, { day: null, week: 3_000_000, month: null, voice: null, images: null }, NOW);

    const response = await request(scope, 'Add lanterns', 'voice-over-energy');

    expect(await response.json()).toEqual({ delivery_id: expect.any(String), status: 'needs_choice' });
    const briefing = await buildBriefing({ db: deps.db, defaults, now: () => NOW }, scope);
    // The draft alone outgrows the weekly ceiling, so queueing for the reset would not help.
    expect(briefing.waiting_on).toBe('Needs more Energy than is left this week: ask an admin');
  });

  it('returns failed without caching it so confirmation can retry', async () => {
    const { message, request } = await setup();
    message.mockRejectedValueOnce(new Error('admission unavailable'));

    const failed = await request(build, 'Make the door red', 'voice-retry');
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      delivery_id: expect.any(String),
      status: 'failed',
    });
    expect(await (await request(build, 'Make the door red', 'voice-retry')).json()).toEqual({
      delivery_id: expect.any(String),
      status: 'delivered',
    });
    expect(message).toHaveBeenCalledTimes(2);
  });
});
