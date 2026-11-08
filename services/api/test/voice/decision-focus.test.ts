import { schema } from '@ogm/db';
import { describe, expect, it } from 'vitest';

import { insertChatRow } from '../../src/build-chat/store.js';
import { buildBriefing, type VoiceTarget } from '../../src/voice/briefing-push.js';
import { ids, NOW, worked } from '../budget/fixture.js';

const defaults = { dailyAllowanceMicroUsd: 5_000_000, resetZone: 'America/Los_Angeles' };
const HASH = 'a'.repeat(64);
const build: VoiceTarget = {
  kind: 'build',
  game_id: ids.game,
  job_id: ids.running,
  ticket: '7',
  creator_id: ids.creator,
};

function fixture() {
  const deps = worked();
  const options = (pairs: [string, string][]) => JSON.stringify(pairs.map(([id, label]) => ({ id, label })));
  deps.db
    .insert(schema.checkpoints)
    .values([
      {
        decisionId: 'd_goblins',
        jobId: ids.running,
        daemonSlug: 'daemon',
        version: 1,
        question: 'How many goblins?',
        options: options([
          ['three', 'Three'],
          ['five', 'Five'],
        ]),
        status: 'open',
        openedAt: '2026-10-31T19:00:00.000Z',
      },
      {
        decisionId: 'd_hero',
        jobId: ids.running,
        daemonSlug: 'daemon',
        version: 2,
        question: 'Which hero look?',
        options: options([
          ['knight', 'Knight'],
          ['theme', 'Theme'],
        ]),
        status: 'open',
        openedAt: '2026-10-31T19:01:00.000Z',
      },
    ])
    .run();
  const still = insertChatRow(deps.sqlite, {
    jobId: ids.running,
    actor: 'agent',
    kind: 'image',
    media: { hash: HASH, width: 1024, height: 768 },
  }).row!;
  const sound = insertChatRow(deps.sqlite, {
    jobId: ids.running,
    actor: 'agent',
    kind: 'clip',
    media: { hash: HASH, width: 1, height: 1, durationMs: 12_400 },
  }).row!;
  insertChatRow(deps.sqlite, {
    jobId: ids.running,
    actor: 'agent',
    kind: 'checkpoint',
    text: 'Which hero look?',
    checkpoint: {
      checkpoint_id: 'cp-hero',
      decision_id: 'd_hero',
      version: 2,
      question: 'Which hero look?',
      options: [
        {
          id: 'knight',
          label: 'Knight',
          media_id: still.id,
          provenance: {
            packs: ['Dusk Helm'],
            assets: [],
            generator: 'gm',
            built_at: NOW.toISOString(),
            kind: 'render',
          },
        },
        { id: 'theme', label: 'Theme', media_id: sound.id },
      ],
      recommend: 'knight',
      status: 'open',
    },
  });
  return deps;
}

describe('voice started from a decision', () => {
  // Kevin (#597): the voice agent gets the question, its options and the media context, so it can explain and
  // compare them. Without the focus it opens on the oldest Command and knows the cards only by their labels.
  it('briefs the opened decision first with what each card is', async () => {
    const deps = fixture();

    const briefing = await buildBriefing(
      { db: deps.db, sqlite: deps.sqlite, defaults, now: () => NOW },
      { ...build, command_id: 'd_hero' },
    );

    expect(briefing.commands?.map(({ id }) => id)).toEqual(['d_hero', 'd_goblins']);
    expect(briefing.questions).toEqual(['Which hero look?', 'How many goblins?']);
    expect(briefing.extra[0]).toEqual({
      title: 'Open decision',
      text: [
        'The creator has this decision open and started voice from it: Which hero look?',
        '- Knight (the builder recommends it): a still image, 1024×768; render, from Dusk Helm',
        '- Theme: a sound, 12 s',
      ].join('\n'),
    });
  });

  it('keeps the plain briefing when voice was not started from a decision', async () => {
    const deps = fixture();

    const briefing = await buildBriefing({ db: deps.db, sqlite: deps.sqlite, defaults, now: () => NOW }, build);

    expect(briefing.commands?.map(({ id }) => id)).toEqual(['d_goblins', 'd_hero']);
    expect(briefing.extra.map(({ title }) => title)).not.toContain('Open decision');
  });
});
