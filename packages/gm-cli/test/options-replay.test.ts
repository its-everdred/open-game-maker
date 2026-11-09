import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AgentOutboxLine, CommandRequestPayload } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { readLedger } from '../src/ledger/index.js';
import { gm, tempDir } from './helpers.js';

const JOB_ID = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';

/** A stand-in option and a KayKit one: the two provenance documents the replay needs. */
const STAND_IN = {
  packs: ['stand-in'],
  assets: ['stand-in/box', 'stand-in/capsule'],
  generator: 'stand-in',
  built_at: '2026-11-06T10:00:00.000Z',
  aspect: 'look',
  kind: 'stand-in',
  view: 'off-camera',
};

// The fresh options are built after the rejection, whose timestamp is the wall clock when the replay runs. Keep the
// KayKit provenance ahead of it so the "predates a rule" check stays false no matter what day the suite runs.
const FRESH_BUILT_AT = new Date(Date.now() + 86_400_000).toISOString();

const KAYKIT = {
  packs: ['kaykit'],
  assets: ['kaykit/knight', 'kaykit/arch'],
  generator: 'blender 4.2 + gm shot',
  built_at: FRESH_BUILT_AT,
  aspect: 'look',
  kind: 'render',
  view: 'player',
};

function game(): string {
  const root = tempDir('gm-ledger-replay-');
  execFileSync('git', ['init', '-q'], { cwd: root });
  mkdirSync(join(root, 'provenance'), { recursive: true });
  writeFileSync(join(root, 'provenance', 'stand-in.json'), JSON.stringify(STAND_IN));
  writeFileSync(join(root, 'provenance', 'kaykit.json'), JSON.stringify(KAYKIT));
  return root;
}

function requestCommand(root: string, argv: string[]) {
  const raw = execFileSync('cat', [join(root, '.gm', 'outbox', 'command.jsonl')], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => AgentOutboxLine.parse(JSON.parse(line)));
  const last = raw[raw.length - 1];
  return CommandRequestPayload.parse(last.payload);
}

/**
 * QA eval #567, replayed from the Blobs story: four options were shown on stand-ins, the creator rejected them with a
 * reason, and a day later the same options came back. Here the rejection lands in the game's ledger, and the second
 * session's options have to clear it before they reach the creator.
 */
describe('a rejected option never comes back', () => {
  it('withdraws the sibling Command and refuses the same options in a new session', async () => {
    const root = game();

    // Session 1: the characters Command and the A–D look Command are both built on the same stand-ins.
    const characters = await gm(
      [
        'command',
        'request',
        '--job',
        JOB_ID,
        '--question',
        'Which characters?',
        '--option',
        'a=Stand-in A',
        '--option',
        'b=Stand-in B',
        '--provenance',
        'a=@provenance/stand-in.json',
        '--provenance',
        'b=@provenance/stand-in.json',
      ],
      { cwd: root },
    );
    expect(characters).toMatchObject({ code: 0, err: [] });
    const charactersCommand = requestCommand(root, []);
    expect(charactersCommand.options[0]).toMatchObject({ id: 'a', provenance: { packs: ['stand-in'] } });

    const look = await gm(
      [
        'command',
        'request',
        '--job',
        JOB_ID,
        '--question',
        'Which look?',
        '--option',
        'a=Chunky',
        '--option',
        'b=Flat',
        '--option',
        'c=Chunky 3D',
        '--option',
        'd=Flat 3D',
        '--provenance',
        'a=@provenance/stand-in.json',
        '--provenance',
        'b=@provenance/stand-in.json',
        '--provenance',
        'c=@provenance/stand-in.json',
        '--provenance',
        'd=@provenance/stand-in.json',
      ],
      { cwd: root },
    );
    expect(look).toMatchObject({ code: 0, err: [] });
    const lookCommand = requestCommand(root, []);

    // The creator's rejection: "those are not characters", because they were stand-ins, not KayKit.
    const rejection = await gm(
      [
        'options',
        'reject',
        '--job',
        JOB_ID,
        '--words',
        'those are not characters',
        '--rule',
        'characters are rigged KayKit models',
        '--scope',
        'characters',
        '--must',
        '{"packs":["kaykit"]}',
        '--option',
        'a=Stand-in A',
        '--option',
        'b=Stand-in B',
        '--provenance',
        'a=@provenance/stand-in.json',
        '--provenance',
        'b=@provenance/stand-in.json',
        '--command',
        charactersCommand.command_id,
        '--json',
      ],
      { cwd: root },
    );
    expect(rejection).toMatchObject({ code: 0, err: [] });
    const written = JSON.parse(rejection.out[0]) as { entry: { id: string; withdrawn: Record<string, string[]> } };
    expect(written.entry.withdrawn.options).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd']));
    expect(written.entry.withdrawn.commands).toEqual(
      expect.arrayContaining([charactersCommand.command_id, lookCommand.command_id]),
    );

    // Today's remaining rules land in the same ledger.
    for (const seed of [
      {
        words: 'looks are KayKit only',
        rule: 'looks are KayKit only',
        scope: 'look',
        must: '{"packs":["kaykit"]}',
      },
      {
        words: 'options are player-view mockups, screenshots and GIFs, never off-camera',
        rule: 'options are player-view mockups (screenshots and GIFs, never off-camera)',
        scope: 'options',
        must: '{"views":["player"]}',
      },
      {
        words: 'the 4 styles vary greatly',
        rule: 'the 4 styles vary greatly',
        scope: 'look',
        must: '{}',
      },
    ]) {
      const seeded = await gm(
        [
          'options',
          'reject',
          '--job',
          JOB_ID,
          '--words',
          seed.words,
          '--rule',
          seed.rule,
          '--scope',
          seed.scope,
          '--must',
          seed.must,
        ],
        { cwd: root },
      );
      expect(seeded).toMatchObject({ code: 0, err: [] });
    }
    expect(readLedger(root).entries).toHaveLength(4);

    // Session 2: the same four options come back. The check fails every one of them.
    const repeated = await gm(
      [
        'options',
        'check',
        '--option',
        'a=Chunky',
        '--option',
        'b=Flat',
        '--option',
        'c=Chunky 3D',
        '--option',
        'd=Flat 3D',
        '--provenance',
        'a=@provenance/stand-in.json',
        '--provenance',
        'b=@provenance/stand-in.json',
        '--provenance',
        'c=@provenance/stand-in.json',
        '--provenance',
        'd=@provenance/stand-in.json',
        '--json',
      ],
      { cwd: root },
    );
    expect(repeated.code).toBe(1);
    const verdict = JSON.parse(repeated.out[0]) as { ok: boolean; violations: { kind: string; option_id: string }[] };
    expect(verdict.ok).toBe(false);
    expect(new Set(verdict.violations.map((violation) => violation.option_id))).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(verdict.violations.map((violation) => violation.kind)).toEqual(
      expect.arrayContaining(['withdrawn', 'rejected']),
    );

    // The stale sibling Command stays withdrawn, so a later session cannot quietly reopen it either.
    const staleCommand = await gm(
      [
        'options',
        'check',
        '--command',
        lookCommand.command_id,
        '--option',
        'a=Chunky',
        '--provenance',
        'a=@provenance/kaykit.json',
        '--json',
      ],
      { cwd: root },
    );
    expect(staleCommand.code).toBe(1);
    expect(JSON.parse(staleCommand.out[0])).toMatchObject({
      ok: false,
      violations: expect.arrayContaining([expect.objectContaining({ kind: 'withdrawn', option_id: 'a' })]),
    });

    // Asking for options again: the same four are refused at open time...
    const refused = await gm(
      [
        'command',
        'request',
        '--job',
        JOB_ID,
        '--question',
        'Which look?',
        '--option',
        'a=Chunky',
        '--option',
        'b=Flat',
        '--provenance',
        'a=@provenance/stand-in.json',
        '--provenance',
        'b=@provenance/stand-in.json',
      ],
      { cwd: root },
    );
    expect(refused.code).toBe(2);
    expect(refused.err.join('\n')).toContain('refused to open a command');

    // ...and fresh KayKit options satisfy every rule and reach the creator.
    const fresh = await gm(
      [
        'options',
        'check',
        '--option',
        'e=KayKit chunky',
        '--option',
        'f=KayKit flat',
        '--provenance',
        'e=@provenance/kaykit.json',
        '--provenance',
        'f=@provenance/kaykit.json',
      ],
      { cwd: root },
    );
    expect(fresh).toMatchObject({ code: 0, err: [] });
    expect(fresh.out[0]).toContain('options ok');

    const reopened = await gm(
      [
        'command',
        'request',
        '--job',
        JOB_ID,
        '--question',
        'Which look?',
        '--option',
        'e=KayKit chunky',
        '--option',
        'f=KayKit flat',
        '--provenance',
        'e=@provenance/kaykit.json',
        '--provenance',
        'f=@provenance/kaykit.json',
      ],
      { cwd: root },
    );
    expect(reopened).toMatchObject({ code: 0, err: [] });
    expect(requestCommand(root, []).options.map((option) => option.id)).toEqual(['e', 'f']);
  }, 60_000);
});
