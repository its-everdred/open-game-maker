import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePremises } from '../src/plan/premises.js';
import { gm, tempDir } from './helpers.js';

const GAME = 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';
const JOB = 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f';

function decision(id: string, chosen: string, extra: { supersedes?: string; at?: string; checkpoint?: string } = {}) {
  return {
    id,
    game_id: GAME,
    job_id: JOB,
    ticket: null,
    checkpoint_id: extra.checkpoint ?? `cp_${id}`,
    decision_id: `dec_${id}`,
    question: 'Which look?',
    options: [
      { id: 'a', label: 'Chunky' },
      { id: 'b', label: 'Flat' },
    ],
    recommended: 'a',
    chosen,
    origin: 'player',
    skipped: false,
    affects: [],
    supersedes: extra.supersedes ?? null,
    at: extra.at ?? '2026-11-08T10:00:00Z',
  };
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

/** A game repo with a spec and an owned file committed at `sha`; `edit` lists files changed in a later commit. */
function repo(edit: string[] = []): { root: string; sha: string } {
  const root = tempDir('gm-premises-');
  git(root, 'init', '-q');
  mkdirSync(join(root, 'docs/spec'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'docs/spec/combat.md'), 'v1\n');
  writeFileSync(join(root, 'src/player.ts'), 'v1\n');
  writeFileSync(join(root, 'src/enemy.ts'), 'v1\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'one');
  const sha = git(root, 'rev-parse', 'HEAD');
  if (edit.length > 0) {
    for (const file of edit) writeFileSync(join(root, file), 'v2\n');
    git(root, 'commit', '-qam', 'two');
  }
  return { root, sha };
}

async function sweep(root: string, tickets: unknown[], decisions: unknown[]) {
  writeFileSync(join(root, 'issues.json'), JSON.stringify(tickets));
  writeFileSync(join(root, 'decisions.json'), JSON.stringify({ decisions }));
  const result = await gm(['plan', 'premises', '--tickets', 'issues.json', '--decisions', 'decisions.json'], {
    cwd: root,
  });
  return { ...result, report: result.out[0] === undefined ? null : JSON.parse(result.out[0]) };
}

function body(lines: string[]): string {
  return ['## Goal', 'Build the thing.', '', ...lines].join('\n');
}

describe('parsePremises', () => {
  it('reads the premise lines a planner writes, in list or bold form, and ignores the rest of the body', () => {
    expect(
      parsePremises(
        [
          'Decisions: D-02, D-05',
          '- **Spec:** `docs/spec/combat.md`, docs/spec/ui.md',
          '* Owns: src/player.ts src/hud/',
          'context-sha: ABCDEF1234567',
          'Context update (dec_x): D-99 is mentioned here but is not a premise',
          'Decisions: D-05 D-07',
        ].join('\n'),
      ),
    ).toEqual({
      decisions: ['D-02', 'D-05', 'D-07'],
      specs: ['docs/spec/combat.md', 'docs/spec/ui.md'],
      owns: ['src/player.ts', 'src/hud/'],
      contextSha: 'abcdef1234567',
    });
  });
});

describe('gm plan premises', () => {
  it('passes an open ticket whose decisions still stand and whose spec and files are unchanged', async () => {
    const { root, sha } = repo(['src/enemy.ts']);
    const ticket = {
      number: 7,
      body: body(['Decisions: D-01', 'Spec: docs/spec/combat.md', 'Owns: src/player.ts', `context-sha: ${sha}`]),
    };
    const result = await sweep(root, [ticket], [decision('D-01', 'a')]);
    expect(result.code).toBe(0);
    expect(result.report).toEqual({ checked: 1, flagged: [], clean: [7], unchecked: [] });
  });

  it('flags a ticket built on a decision the creator later changed, and names the decision that now stands', async () => {
    const { root } = repo();
    const result = await sweep(
      root,
      [{ number: 7, title: 'voice: hero', body: body(['Decisions: D-01']) }],
      [
        decision('D-01', 'a'),
        decision('D-02', 'b', { supersedes: 'D-01', at: '2026-11-08T11:00:00Z' }),
        decision('D-03', 'a', { supersedes: 'D-02', at: '2026-11-08T12:00:00Z' }),
      ],
    );
    expect(result.code).toBe(1);
    // D-03 restored the original choice, so the premise holds but cites a stale record: superseded, not revised.
    expect(result.report.flagged[0]).toMatchObject({
      ticket: 7,
      title: 'voice: hero',
      reasons: [{ kind: 'decision_superseded', decision: 'D-01', current: 'D-03' }],
    });
  });

  it('calls it revised when the standing answer differs from the one the ticket was written from', async () => {
    const { root } = repo();
    const result = await sweep(
      root,
      [{ number: 8, body: body(['Decisions: D-01']) }],
      [decision('D-01', 'a'), decision('D-02', 'b', { supersedes: 'D-01', at: '2026-11-08T11:00:00Z' })],
    );
    expect(result.report.flagged[0].reasons).toEqual([{ kind: 'decision_revised', decision: 'D-01', current: 'D-02' }]);
  });

  it('flags a decision whose answer a later ledger rejection took back, and one missing from the history', async () => {
    const { root } = repo();
    const reject = (extra: string[]) =>
      gm(['options', 'reject', '--words', 'not that', '--rule', 'not that', '--scope', 'look', ...extra], {
        cwd: root,
      });
    // The creator rejects option a shown under cp_D-01, and a later rejection withdraws the Command cp_D-03.
    await reject(['--option', 'a=Chunky', '--command', 'cp_D-01']);
    await reject(['--withdraw-command', 'cp_D-03']);
    const before = '2026-01-01T00:00:00Z';
    const result = await sweep(
      root,
      [
        { number: 9, body: body(['Decisions: D-01, D-04']) },
        { number: 14, body: body(['Decisions: D-03']) },
        { number: 15, body: body(['Decisions: D-05, D-06']) },
        { number: 16, body: body(['No premise lines here.']) },
      ],
      [
        decision('D-01', 'a', { at: before }),
        decision('D-03', 'b', { at: before }),
        // Same Command, but its answer is b, which nobody rejected.
        decision('D-05', 'b', { at: before, checkpoint: 'cp_D-01' }),
        // Picked a again after the rejection: the later answer stands.
        decision('D-06', 'a', { at: '2099-01-01T00:00:00Z', checkpoint: 'cp_D-01' }),
      ],
    );
    expect(result.code).toBe(1);
    const reasons = Object.fromEntries(
      result.report.flagged.map((verdict: { ticket: number; reasons: unknown[] }) => [verdict.ticket, verdict.reasons]),
    );
    expect(reasons[9]).toEqual([
      expect.objectContaining({ kind: 'decision_mooted', decision: 'D-01' }),
      { kind: 'decision_unknown', decision: 'D-04' },
    ]);
    expect(reasons[14]).toEqual([expect.objectContaining({ kind: 'decision_mooted', decision: 'D-03' })]);
    // A ticket naming no premise is not vouched for as clean.
    expect(result.report).toMatchObject({ checked: 4, clean: [15], unchecked: [16] });
  });

  it('flags spec and owned-file changes after context-sha, naming only the changed files', async () => {
    const { root, sha } = repo(['docs/spec/combat.md', 'src/player.ts', 'src/enemy.ts']);
    const result = await sweep(
      root,
      [
        {
          number: 10,
          body: body(['Spec: docs/spec/combat.md', 'Owns: src/player.ts, src/hud/', `context-sha: ${sha}`]),
        },
      ],
      [],
    );
    expect(result.code).toBe(1);
    expect(result.report.flagged[0].reasons).toEqual([
      { kind: 'spec_changed', files: ['docs/spec/combat.md'] },
      { kind: 'owned_changed', files: ['src/player.ts'] },
    ]);
  });

  it('flags a ticket that cites a spec without a context-sha, or with a sha the repo does not know', async () => {
    const { root } = repo();
    const result = await sweep(
      root,
      [
        { number: 11, body: body(['Spec: docs/spec/combat.md']) },
        { number: 12, body: body(['Spec: docs/spec/combat.md', 'context-sha: deadbeefdeadbeef']) },
      ],
      [],
    );
    expect(result.report.flagged.map((verdict: { reasons: unknown[] }) => verdict.reasons)).toEqual([
      [{ kind: 'context_sha_missing' }],
      [{ kind: 'context_sha_unknown', sha: 'deadbeefdeadbeef' }],
    ]);
  });

  it('skips closed tickets and refuses a decisions file of the wrong shape', async () => {
    const { root } = repo();
    const closed = await sweep(root, [{ number: 13, state: 'CLOSED', body: body(['Decisions: D-09']) }], []);
    expect(closed.report).toEqual({ checked: 0, flagged: [], clean: [], unchecked: [] });

    writeFileSync(join(root, 'issues.json'), '[]');
    writeFileSync(join(root, 'decisions.json'), '{"decisions":[{"id":"nope"}]}');
    const bad = await gm(['plan', 'premises', '--tickets', 'issues.json', '--decisions', 'decisions.json'], {
      cwd: root,
    });
    expect(bad.code).toBe(2);
    expect(bad.err[0]).toContain('--decisions decisions.json has the wrong shape');
  });
});
