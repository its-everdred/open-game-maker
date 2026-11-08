import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { journeySchema } from '@ogm/gm-verify';

import { describe, expect, it } from 'vitest';

import { COMMANDS_DIR, loadCommands } from '../src/cli.js';
import { localRoomBlocker, scenarioScript } from '../src/commands/qa/room.js';
import { extractCommands } from '../src/skills/lint.js';
import { gm, tempDir } from './helpers.js';

const BUILD = 'https://games.example:10000/g/game_1/build_1/';

function journey(dir: string, name: string, body: object): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify({ name, ...body }));
  return path;
}

describe('gm qa usage', () => {
  it('refuses to run without a build URL or with one that is not http(s)', async () => {
    expect((await gm(['qa', 'open'])).err).toEqual([
      '--url is required. Try: gm qa open --url https://<games-host>:10000/g/<game>/<build>/',
    ]);
    const file = await gm(['qa', 'open', '--url', 'file:///etc/passwd']);
    expect(file.code).toBe(2);
    expect(file.err[0]).toMatch(/^--url must be http or https\./);
  });

  it('sends a room journey to gm qa room and a solo journey to gm qa drive', async () => {
    const dir = tempDir();
    const room = journey(dir, 'online', {
      kind: 'room',
      host: [{ do: 'click', text: 'Online' }],
      join: [{ do: 'goto', url: '{link}' }],
      seated: { do: 'expect', text: '{clients} players' },
      countdown: { do: 'expect', text: '3' },
      move: { steps: [{ do: 'press', key: 'ArrowLeft' }], expect: { do: 'expect', pixels: 'changed' } },
      rejoin: { do: 'expect', text: 'Back' },
    });
    const solo = journey(dir, 'solo', { steps: [{ do: 'click', text: 'Play' }] });
    expect((await gm(['qa', 'drive', '--url', BUILD, '--journey', room], { cwd: dir })).err).toEqual([
      `online is a room journey. Try: gm qa room --journey ${room}`,
    ]);
    expect((await gm(['qa', 'room', '--url', BUILD, '--journey', solo], { cwd: dir })).err).toEqual([
      `solo is not a room journey. Try: gm qa drive --journey ${solo}`,
    ]);
  });

  it('names the schema problem in a journey instead of driving half of it', async () => {
    const dir = tempDir();
    const bad = journey(dir, 'bad', { steps: [{ do: 'click' }] });
    const result = await gm(['qa', 'drive', '--url', BUILD, '--journey', bad], { cwd: dir });
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('click needs text or selector');
  });

  it('holds a room to 2-4 clients and a local room to the simulator four', async () => {
    expect((await gm(['qa', 'room', '--url', BUILD, '--clients', '5', '--journey', 'x.json'])).err).toEqual([
      '--clients must be 2, 3 or 4. Try: gm qa room --clients 2',
    ]);
    expect((await gm(['qa', 'room', '--local', '--clients', '2'])).err).toEqual([
      '--local always seats 4 clients. Try: gm qa room --local',
    ]);
    expect((await gm(['qa', 'room', '--local', '--url', BUILD])).err).toEqual([
      '--local tests the local build, not --url. Try: gm qa room --local',
    ]);
  });

  it('runs --local through the gm-verify four-client scenario that exists beside the package', () => {
    expect(existsSync(scenarioScript())).toBe(true);
    expect(readFileSync(scenarioScript(), 'utf8')).toContain("'multi-client'");
    expect(localRoomBlocker(scenarioScript())).toBeUndefined();
  });

  it('says --local is core-only from a game instance instead of letting Node refuse the scenario', () => {
    /* An instance installs gm-verify from its vendored tarball; Node will not strip types under node_modules. */
    const vendored = '/srv/blobs/node_modules/.pnpm/@ogm+gm-verify@file+vendor/node_modules/@ogm/gm-verify/scenarios/scenario.ts';
    expect(localRoomBlocker(vendored)).toBe(
      '--local runs only from an Open Game Maker core checkout, not a game instance',
    );
    expect(localRoomBlocker('C:\\blobs\\node_modules\\@ogm\\gm-verify\\scenarios\\scenario.ts')).toBeDefined();
  });
});

describe('gm qa look', () => {
  /** A game workspace with one creator rule in its ledger and one finished journey in shots/qa. */
  function game(): string {
    const root = tempDir('gm-qa-game-');
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeFileSync(join(root, 'gm.manifest.json'), '{}');
    mkdirSync(join(root, 'design'));
    writeFileSync(
      join(root, 'design', 'feedback.json'),
      JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            id: 'fb_01M6W453WWRK4VATFH10N1W42P',
            at: '2026-11-07T23:05:32.322Z',
            words: 'those are not characters',
            rule: 'Characters are rigged models, never stand-ins.',
            scope: 'characters',
            must: {},
            design_version: '0.0.0',
            rejected: { options: [], command: null, media: [] },
            withdrawn: { options: [], commands: [] },
          },
        ],
      }),
    );
    const run = join(root, 'shots', 'qa', 'solo-cpu');
    mkdirSync(run, { recursive: true });
    writeFileSync(
      join(run, 'journey-result.json'),
      JSON.stringify({
        journey: 'solo-cpu',
        url: BUILD,
        viewport: 'desktop',
        verdict: 'pass',
        steps: [{ index: 0, step: 'shot end', ok: true, ms: 1, shot: 'desktop-01-end.png' }],
        skipped: 0,
        console: [],
        clip: { mp4: 'journey.mp4', gif: 'journey.gif' },
        unchecked: [],
      }),
    );
    return root;
  }

  it("asks the ledger's rules of the run's stills, then reports unchecked (exit 1) until they are answered", async () => {
    const root = game();
    const look = await gm(['qa', 'look'], { cwd: root });
    expect(look.code).toBe(0);
    /* The looker opens these as printed, from where it ran gm, not from inside the run directory. */
    expect(look.out).toContain('look-1: shots/qa/solo-cpu/desktop-01-end.png');
    expect(look.out).toContain(
      '  solo-cpu#rule1 Does this keep the creator\'s rule: "Characters are rigged models, never stand-ins."?',
    );
    const unanswered = await gm(['qa', 'look', '--report'], { cwd: root });
    expect(unanswered).toMatchObject({ code: 1, out: ['unchecked shots/qa/qa-report.md'] });

    writeFileSync(join(root, 'shots/qa/look/answers.json'), JSON.stringify({ 'solo-cpu#rule1': { pass: true } }));
    expect(await gm(['qa', 'look', '--report'], { cwd: root })).toMatchObject({
      code: 0,
      out: ['pass shots/qa/qa-report.md'],
    });
    expect(readFileSync(join(root, 'shots/qa/qa-report.md'), 'utf8')).toContain('| shot end | pass |');
  });

  it('refuses when there is no run to look at', async () => {
    const result = await gm(['qa', 'look'], { cwd: tempDir() });
    expect(result.code).toBe(2);
    expect(result.err[0]).toMatch(/^no qa run in shots\/qa\./);
  });
});

describe('gm-qa skill', () => {
  const SKILL = fileURLToPath(new URL('../../../skills/gm-qa/', import.meta.url));

  it('names only registered gm commands, so the skill cannot teach one that does not exist', async () => {
    const registry = await loadCommands(COMMANDS_DIR);
    const named = extractCommands(readFileSync(join(SKILL, 'SKILL.md'), 'utf8')).map((c) => c.replace(/^gm /, ''));
    expect(named).toEqual(expect.arrayContaining(['qa open', 'qa drive', 'qa room', 'qa look']));
    expect(named.filter((name) => !registry.has(name))).toEqual([]);
  });

  it("ships Blobs' five journeys, each one the schema accepts", () => {
    const dir = join(SKILL, 'journeys', 'blobs');
    const journeys = readdirSync(dir).map((file) =>
      journeySchema.parse(JSON.parse(readFileSync(join(dir, file), 'utf8'))),
    );
    expect(journeys.map((j) => `${j.name}:${j.kind}`).sort()).toEqual([
      'hud-clear:solo',
      'laptop-keys:solo',
      'online-2p:room',
      'phone-touch:solo',
      'solo-cpu:solo',
    ]);
  });
});
