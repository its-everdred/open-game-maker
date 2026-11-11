import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkSkill, extractCommands, extractSdkNames } from '../src/skills/lint.js';
import { tempDir } from './helpers.js';

describe('skill reference lint', () => {
  it('recognizes capture and Python subcommands while retaining the Python runner', () => {
    expect(
      extractCommands('Use `gm capture shell --web path`, `gm py setup`, `gm py -- -c code`, and `gm py script.py`.'),
    ).toEqual(['gm capture shell', 'gm py setup', 'gm py']);
  });
  it('extracts inline gm invocations and sdk paths without duplicates', () => {
    const markdown = [
      'Run `gm run --inputs inputs.json`, then call `sdk.audio.unlock` with an `ActionFrame`.',
      'Run `gm run --inputs other.json`, `gm check --json`, and `gm scope done`.',
      'From `@gm/sdk/audio`, call `play()`.',
    ].join('\n');

    expect(extractCommands(markdown)).toEqual(['gm run', 'gm check', 'gm scope done']);
    expect(extractSdkNames(markdown)).toEqual(['audio.unlock', 'ActionFrame', 'audio.play']);
  });

  it('accepts references present in the command registry and sdk export tree', () => {
    const file = join(tempDir('gm-skill-lint-'), 'SKILL.md');
    writeFileSync(file, 'Use `gm assets use selected-id`, `ActionFrame.playerIndex`, and `sdk.audio.unlock`.\n');

    expect(
      checkSkill(file, {
        commands: new Set(['assets use', 'run']),
        sdkExports: { ActionFrame: { playerIndex: true }, audio: { unlock: () => undefined } },
      }),
    ).toEqual({ commands: [], sdk: [] });
  });

  it('reports unknown commands and sdk paths with their written names', () => {
    const file = join(tempDir('gm-skill-lint-'), 'SKILL.md');
    writeFileSync(file, 'Use `gm nope --fast`, `ActionFramme`, `sdk.audio.playy`, and `sdk.toString`.\n');

    expect(
      checkSkill(file, {
        commands: new Set(['run']),
        sdkExports: { audio: { play: () => undefined } },
      }),
    ).toEqual({ commands: ['gm nope'], sdk: ['ActionFramme', 'audio.playy', 'toString'] });
  });
});
