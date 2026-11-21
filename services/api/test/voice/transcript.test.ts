import { schema } from '@ogm/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { listSince } from '../../src/build-chat/store.js';
import { gameDrafts } from '../../src/new-game/drafts.js';
import { scopeSessions } from '../../src/scope/store.js';
import type { VoiceTarget } from '../../src/voice/briefing-push.js';
import { ids, worked } from '../budget/fixture.js';
import { makeApp } from '../helpers.js';

const SECRET = 'voice-internal-secret-for-tests';
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
  session_id: 's_28000000-0000-4000-8000-000000000001',
  creator_id: ids.creator,
};

async function setup() {
  const deps = worked();
  deps.config.voiceInternalSecret = SECRET;
  deps.db
    .update(schema.jobs)
    .set({ aiurRepo: 'owner/game', aiurIssueNumber: 7 })
    .where(eq(schema.jobs.id, ids.running))
    .run();
  scopeSessions.create(deps.db, {
    id: scope.session_id,
    gameId: ids.game,
    creatorId: ids.creator,
    jobId: ids.running,
    choices: {
      genre: 'platformer',
      vibe: 'cozy',
      family: 'chunky-low-poly',
      world: 'cavern',
      players: 'single',
      pov: 'side-on',
    },
    at: new Date().toISOString(),
  });
  const { app } = await makeApp(deps);
  const request = (
    target: VoiceTarget,
    actor: 'creator' | 'agent',
    text: string,
    turnId = 'turn-one',
    secret = SECRET,
    conversationId = 'conversation-one',
  ) =>
    app.request('/internal/voice/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ogm-internal': secret },
      body: JSON.stringify({
        target,
        conversation_id: conversationId,
        turn_id: turnId,
        actor,
        text,
      }),
    });
  return { deps, request };
}

describe('POST /internal/voice/transcript', () => {
  it('creates one edit job on the first spoken turn and attaches both sides of the conversation', async () => {
    const { deps, request } = await setup();
    const target: VoiceTarget = {
      kind: 'edit',
      game_id: ids.game,
      creator_id: ids.creator,
      session_id: '29000000-0000-4000-8000-000000000001',
    };
    const first = await request(target, 'creator', 'Make the bridge wider', 'edit-user-1');
    const replay = await request(target, 'creator', 'Make the bridge wider', 'edit-user-1');
    const reply = await request(target, 'agent', 'I can do that.', 'edit-agent-1');
    expect(first.status).toBe(200);
    expect(await replay.json()).toMatchObject({ inserted: false });
    expect(reply.status).toBe(200);
    const jobs = deps.db
      .select()
      .from(schema.jobs)
      .all()
      .filter((job) => job.idempotencyKey?.startsWith('voice-edit:'));
    expect(jobs).toHaveLength(1);
    expect(listSince(deps.sqlite, jobs[0]!.id, 0).map(({ text }) => text)).toEqual([
      'Make the bridge wider',
      'I can do that.',
    ]);
  });

  it('preserves a long opening turn without exceeding the job plan limit', async () => {
    const { deps, request } = await setup();
    const target: VoiceTarget = {
      kind: 'edit',
      game_id: ids.game,
      creator_id: ids.creator,
      session_id: '29000000-0000-4000-8000-000000000002',
    };
    const text = 'x'.repeat(5000);
    expect((await request(target, 'creator', text)).status).toBe(200);
    const job = deps.db
      .select()
      .from(schema.jobs)
      .all()
      .find((row) => row.idempotencyKey?.startsWith('voice-edit:'))!;
    expect(JSON.parse(job.plan).summary).toHaveLength(4000);
    expect(listSince(deps.sqlite, job.id, 0)[0]!.text).toBe(text);
  });
  it('appends final creator and agent build turns exactly once without Aiur mirroring', async () => {
    const { deps, request } = await setup();

    const creator = await request(build, 'creator', 'Make the bridge wider', 'user-1');
    const replay = await request(build, 'creator', 'Make the bridge wider', 'user-1');
    const agent = await request(build, 'agent', 'I can widen the bridge.', 'agent-1');

    expect(creator.status).toBe(200);
    expect(await creator.json()).toMatchObject({ message_id: expect.stringMatching(/^m_/), inserted: true });
    expect(await replay.json()).toMatchObject({ message_id: expect.stringMatching(/^m_/), inserted: false });
    expect(await agent.json()).toMatchObject({ message_id: expect.stringMatching(/^m_/), inserted: true });
    expect(listSince(deps.sqlite, ids.running, 0)).toEqual([
      expect.objectContaining({
        actor: 'creator',
        kind: 'text',
        text: 'Make the bridge wider',
        aiurTicket: null,
        mirrorState: null,
      }),
      expect.objectContaining({
        actor: 'agent',
        kind: 'text',
        text: 'I can widen the bridge.',
        aiurTicket: null,
        mirrorState: null,
      }),
    ]);
  });

  it('routes a scope turn to the scope session chat job', async () => {
    const { deps, request } = await setup();

    const response = await request(scope, 'agent', 'A cozy cavern platformer sounds good.');

    expect(response.status).toBe(200);
    expect(listSince(deps.sqlite, ids.running, 0)).toEqual([
      expect.objectContaining({ actor: 'agent', text: 'A cozy cavern platformer sounds good.' }),
    ]);
  });

  it('routes pre-Finish draft dictation to its temporary chat without a game row', async () => {
    const { deps, request } = await setup();
    const draft = gameDrafts.create(deps.db, {
      familyId: ids.family,
      creatorId: ids.creator,
      choices: {
        genre: 'platformer',
        vibe: 'cozy',
        family: 'chunky-low-poly',
        world: 'cavern',
        players: 'single',
        pov: 'side-on',
      },
      allowAiGeneratedAssets: true,
    });
    gameDrafts.attachTicket(deps.db, draft.id, 'owner/instance', 42);
    const target: VoiceTarget = {
      kind: 'scope',
      game_id: draft.id,
      session_id: draft.id,
      creator_id: ids.creator,
    };

    const response = await request(target, 'creator', 'Make it a moonlit cavern', 'draft-user-1');

    expect(response.status).toBe(200);
    expect(listSince(deps.sqlite, `draft:${draft.id}`, 0)).toEqual([
      expect.objectContaining({ actor: 'creator', text: 'Make it a moonlit cavern' }),
    ]);
    expect(deps.db.select().from(schema.games).all()).toHaveLength(1); // only the fixture game exists
  });

  it('keeps structured idempotency fields distinct when identifiers contain separators', async () => {
    const { deps, request } = await setup();

    const first = await request(build, 'creator', 'First', 'y:agent:z', SECRET, 'x');
    const second = await request(build, 'agent', 'Second', 'z', SECRET, 'x:creator:y');

    expect(await first.json()).toMatchObject({ inserted: true });
    expect(await second.json()).toMatchObject({ inserted: true });
    expect(listSince(deps.sqlite, ids.running, 0).map(({ text }) => text)).toEqual(['First', 'Second']);
  });

  it('rejects a wrong internal secret before writing chat', async () => {
    const { deps, request } = await setup();

    const response = await request(build, 'creator', 'secret', 'user-2', 'wrong');

    expect(response.status).toBe(401);
    expect(listSince(deps.sqlite, ids.running, 0)).toEqual([]);
  });

  it('rejects stale or forged build and scope targets', async () => {
    const { deps, request } = await setup();
    const forgedBuild = { ...build, creator_id: ids.other };
    const forgedScope = { ...scope, session_id: 'missing' };

    expect((await request(forgedBuild, 'creator', 'no', 'user-3')).status).toBe(404);
    expect((await request(forgedScope, 'agent', 'no', 'agent-3')).status).toBe(404);
    expect(listSince(deps.sqlite, ids.running, 0)).toEqual([]);
  });

  it('rejects empty or oversized transcript fields', async () => {
    const { deps, request } = await setup();

    expect((await request(build, 'creator', ' ')).status).toBe(400);
    expect((await request(build, 'creator', 'x'.repeat(8_001))).status).toBe(400);
    expect((await request(build, 'creator', 'ok', 'x'.repeat(129))).status).toBe(400);
    expect(listSince(deps.sqlite, ids.running, 0)).toEqual([]);
  });
});
