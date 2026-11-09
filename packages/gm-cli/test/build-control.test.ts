import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { gm, tempDir } from './helpers.js';

/*
 * `gm build pause|resume|park|requeue|state|hold-pr` must reach aiur only through aiur's own commands, and per game
 * only for that game's tickets: Dusk Helm stays held while Blobs is resumed, so no path may fall back to `--all`.
 */

type Issue = {
  number: number;
  title: string;
  labels: string[];
  pr?: { number: number; draft?: boolean; ci?: string | null };
  closed?: boolean;
};

const ISSUES: Issue[] = [
  { number: 11, title: 'Blobs jump', labels: ['game:blobs', 'agent:in-progress'] },
  { number: 12, title: 'Blobs coins', labels: ['game:blobs', 'agent:ci-wait'], pr: { number: 40, ci: 'FAILURE' } },
  { number: 20, title: 'Dusk Helm sails', labels: ['game:dusk-helm', 'agent:todo', 'agent:paused'] },
  { number: 30, title: 'Repo chore', labels: ['agent:todo'] },
  { number: 40, title: 'Meadow follow-up', labels: ['game:meadow'] },
  { number: 41, title: 'Meadow redo', labels: ['game:meadow', 'agent:done'], closed: true },
];

let root: string;
let aiurLog: string;
let ghLog: string;
let env: Record<string, string>;

function node(issue: Issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.closed ? 'CLOSED' : 'OPEN',
    labels: { nodes: issue.labels.map((name) => ({ name })) },
    closedByPullRequestsReferences: {
      nodes: issue.pr
        ? [
            {
              number: issue.pr.number,
              url: `https://github.com/acme/games/pull/${issue.pr.number}`,
              isDraft: issue.pr.draft ?? false,
              state: 'OPEN',
              commits: { nodes: [{ commit: { statusCheckRollup: issue.pr.ci ? { state: issue.pr.ci } : null } }] },
            },
          ]
        : [],
    },
  };
}

/* A `gh api graphql` stand-in answering the two queries gm sends from a JSON file of issues. */
function writeGh(bin: string): void {
  writeFileSync(join(root, 'issues.json'), JSON.stringify(ISSUES.map(node)));
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash\nexec node ${JSON.stringify(join(root, 'gh.cjs'))} "$@"\n`);
  writeFileSync(
    join(root, 'gh.cjs'),
    [
      "const fs = require('node:fs');",
      'const args = process.argv.slice(2);',
      `if (args[0] !== 'api') { fs.appendFileSync(${JSON.stringify(join(root, 'gh.log'))}, JSON.stringify(args) + '\\n'); process.exit(0); }`,
      "const vars = Object.fromEntries(args.filter((a, i) => i > 0 && /^-[fF]$/.test(args[i - 1])).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));",
      `const issues = JSON.parse(fs.readFileSync(${JSON.stringify(join(root, 'issues.json'))}, 'utf8'));`,
      "if (vars.name !== 'games') { console.error('Could not resolve to a Repository'); process.exit(1); }",
      'let data;',
      'if (vars.number) data = { repository: { issue: issues.find((i) => i.number === Number(vars.number)) ?? null } };',
      'else data = { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null },',
      '  nodes: issues.filter((i) => i.labels.nodes.some((l) => l.name === vars.label)) } } };',
      'process.stdout.write(JSON.stringify({ data }));',
    ].join('\n'),
  );
  chmodSync(join(bin, 'gh'), 0o755);
}

/* An `aiur` stand-in that logs every call; `units` answers from units.json, and AIUR_FAIL refuses with aiur's words. */
function writeAiur(bin: string): void {
  writeFileSync(
    join(bin, 'aiur'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> ${JSON.stringify(aiurLog)}`,
      'if [ -n "${AIUR_FAIL:-}" ]; then echo "$AIUR_FAIL" >&2; exit 1; fi',
      `if [ "$1" = units ]; then if [ -f ${JSON.stringify(join(root, 'units.json'))} ]; then cat ${JSON.stringify(join(root, 'units.json'))}; exit 0; fi; echo "aiur: unknown command: units" >&2; exit 1; fi`,
      'echo "aiur: $1 ok"',
    ].join('\n'),
  );
  chmodSync(join(bin, 'aiur'), 0o755);
}

function ghWrites(): string[][] {
  return existsSync(ghLog)
    ? readFileSync(ghLog, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
    : [];
}

function aiurCalls(): string[] {
  return existsSync(aiurLog) ? readFileSync(aiurLog, 'utf8').trim().split('\n').filter(Boolean) : [];
}

beforeEach(() => {
  root = tempDir('gm-build-control-');
  aiurLog = join(root, 'aiur.log');
  ghLog = join(root, 'gh.log');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeGh(bin);
  writeAiur(bin);
  // eslint-disable-next-line no-restricted-properties -- the fakes sit in front of the real PATH (bash, node)
  env = { PATH: `${bin}:${process.env.PATH ?? ''}`, OGM_INSTANCE_REPO: 'acme/games', OGM_ENV_DIR: join(root, 'env') };
});

describe('gm build per-ticket controls', () => {
  it.each([
    ['pause', 'pause 11'],
    ['resume', 'resume 11'],
    ['park', 'park 11'],
    ['requeue', '--todo 11'],
  ])('%s maps onto one aiur call for that ticket', async (verb, call) => {
    const result = await gm(['build', verb, '#11'], { env });
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(aiurCalls()).toEqual([call]);
  });

  it('refuses a ticket without a game: label before calling aiur', async () => {
    const result = await gm(['build', 'pause', '30'], { env });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('#30 has no game: label');
    expect(aiurCalls()).toEqual([]);
  });

  it("fails with aiur's own reason when aiur refuses", async () => {
    const result = await gm(['build', 'park', '11'], {
      env: { ...env, AIUR_FAIL: 'aiur: park refused: pause holds no slot' },
    });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('pause holds no slot');
  });

  it('names the missing instance repository', async () => {
    const result = await gm(['build', 'pause', '11'], { env: { ...env, OGM_INSTANCE_REPO: '' } });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('no instance repository');
  });

  it('reads the instance repository from api.env when the environment lacks it', async () => {
    mkdirSync(join(root, 'env'));
    writeFileSync(join(root, 'env', 'api.env'), 'OGM_INSTANCE_REPO=acme/games\n');
    const result = await gm(['build', 'pause', '11'], { env: { ...env, OGM_INSTANCE_REPO: '' } });
    expect(result.code).toBe(0);
    expect(aiurCalls()).toEqual(['pause 11']);
  });
});

describe('gm build park --on', () => {
  // The API releases a ticket by its `waits:` label and reads `--when` from the comment's marker (#680), so both must be
  // written; a held ticket is still parked so its slot frees while it waits.
  it('labels and comments the wait, then parks the held ticket', async () => {
    const result = await gm(['build', 'park', '11', '--on', 'blobs/diorama'], { env });
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    const writes = ghWrites();
    expect(writes[0]).toEqual(expect.arrayContaining(['label', 'create', 'waits:blobs/diorama', '-R', 'acme/games']));
    expect(writes[1]!.slice(0, 5)).toEqual(['issue', 'comment', '11', '-R', 'acme/games']);
    expect(writes[1]!.at(-1)).toContain('<!-- gm-waits-on:{"key":"blobs/diorama"} -->');
    expect(writes[2]).toEqual(['issue', 'edit', '11', '-R', 'acme/games', '--add-label', 'waits:blobs/diorama']);
    expect(aiurCalls()).toEqual(['park 11']);
  });

  // Parking after the label would let a poll release the ticket first and the park hold it again, wait spent.
  it('records nothing when aiur refuses to park the held ticket', async () => {
    const result = await gm(['build', 'park', '11', '--on', 'blobs/diorama'], {
      env: { ...env, AIUR_FAIL: 'aiur: park refused: ticket is not paused' },
    });
    expect(result.code).toBe(1);
    expect(ghWrites()).toEqual([]);
  });

  it('only labels follow-up work aiur does not hold, with the option that starts it', async () => {
    for (const ticket of ['40', '41']) {
      const result = await gm(['build', 'park', ticket, '--on', 'dec_0123456789abcdef', '--when', 'b'], { env });
      expect(result.code).toBe(0);
    }
    const comments = ghWrites().filter(([verb, action]) => verb === 'issue' && action === 'comment');
    expect(comments.map((args) => args.at(-1))).toEqual([
      expect.stringContaining('<!-- gm-waits-on:{"key":"dec_0123456789abcdef","when":"b"} -->'),
      expect.stringContaining('<!-- gm-waits-on:{"key":"dec_0123456789abcdef","when":"b"} -->'),
    ]);
    expect(aiurCalls()).toEqual([]);
  });

  it('refuses a key that cannot be a label, and --when without --on, before writing anything', async () => {
    expect((await gm(['build', 'park', '11', '--on', 'Blobs Diorama'], { env })).code).toBe(2);
    expect((await gm(['build', 'park', '11', '--when', 'b'], { env })).code).toBe(2);
    expect((await gm(['build', 'park', '11', '--on', 'x', '--when', 'Big B'], { env })).code).toBe(2);
    expect(ghWrites()).toEqual([]);
    expect(aiurCalls()).toEqual([]);
  });
});

describe('gm build pause|resume --game', () => {
  it("pauses only that game's open tickets, in one aiur call, never --all", async () => {
    const result = await gm(['build', 'pause', '--game', 'blobs'], { env });
    expect(result.code).toBe(0);
    expect(aiurCalls()).toEqual(['pause 11 12']);
  });

  it('resuming one game leaves the held Dusk Helm ticket alone', async () => {
    const result = await gm(['build', 'resume', '--game', 'blobs', '--json'], { env });
    expect(result.code).toBe(0);
    expect(aiurCalls()).toEqual(['resume 11 12']);
    expect(JSON.parse(result.out[0]!)).toMatchObject({ ok: true, game: 'blobs', tickets: [11, 12] });
  });

  it('calls nothing for a game with no open tickets', async () => {
    const result = await gm(['build', 'pause', '--game', 'nothing-here'], { env });
    expect(result.code).toBe(0);
    expect(result.out[0]).toContain('no open tickets labelled game:nothing-here');
    expect(aiurCalls()).toEqual([]);
  });

  it('refuses a ticket and --game together', async () => {
    const result = await gm(['build', 'pause', '11', '--game', 'blobs'], { env });
    expect(result.code).toBe(2);
    expect(aiurCalls()).toEqual([]);
  });
});

describe('gm build state', () => {
  it('shows labels, PR and CI from GitHub and status from aiur; owner and skills stay - until aiur serves them', async () => {
    writeFileSync(
      join(root, 'units.json'),
      JSON.stringify({
        data: {
          view: {
            rows: [{ identity: { identifier: '12' }, runtime: { work_state: 'waiting', waiting_reason: 'ci' } }],
          },
        },
      }),
    );
    const result = await gm(['build', 'state', '12', '--json'], { env });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out[0]!)).toMatchObject({
      ticket: 12,
      game: 'blobs',
      state: 'ci-wait',
      status: 'waiting',
      owner: '-',
      pr: '#40',
      ci: 'failure',
      paused: '-',
      skills: '-',
    });
  });

  it('still answers from GitHub when aiur cannot report status, and says why', async () => {
    const result = await gm(['build', 'state', '20'], { env });
    expect(result.code).toBe(0);
    expect(result.out).toContain('state: todo');
    expect(result.out).toContain('aiur: -');
    expect(result.out).toContain('paused: paused');
    expect(result.err.join('\n')).toContain('aiur status unavailable: aiur: unknown command: units');
  });

  it('gives one line per ticket of a game', async () => {
    const result = await gm(['build', 'state', '--game', 'blobs'], { env });
    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      '#11  in-progress  -  PR - -  Blobs jump',
      '#12  ci-wait  -  PR #40 failure  Blobs coins',
    ]);
  });
});

describe('gm build hold-pr', () => {
  it('refuses, naming the missing aiur interface, and calls nothing', async () => {
    const result = await gm(['build', 'hold-pr', '12'], { env });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('aiur has no interface to take a ticket out of ci-wait');
    expect(aiurCalls()).toEqual([]);
  });
});
