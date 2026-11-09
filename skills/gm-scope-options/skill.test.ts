import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { COMMANDS_DIR, checkSkill, loadCommands } from '@ogm/gm-cli';
import { describe, expect, it } from 'vitest';

const SKILL = fileURLToPath(new URL('./SKILL.md', import.meta.url));

describe('gm-scope-options skill', () => {
  it('stays short and teaches only live scope commands', async () => {
    const text = readFileSync(SKILL, 'utf8');
    const commands = new Set((await loadCommands(COMMANDS_DIR)).keys());

    expect(text.trimEnd().split('\n').length).toBeLessThanOrEqual(80);
    expect(text).toContain('`gm.lock.json`');
    expect(text).toContain('genre, vibe, world, and players');
    expect(text).toContain('fewer than three concrete game nouns');
    expect(text).toContain('three clearly different takes');
    expect(text).toContain('at most three Commands');
    expect(text).toContain('## Acceptance');
    expect(text).toContain('observable keep and kill criteria');
    expect(text).toContain("defaults I'd reach for");
    expect(checkSkill(SKILL, { commands, sdkExports: {} })).toEqual({ commands: [], sdk: [] });
  }, 30_000);
});
