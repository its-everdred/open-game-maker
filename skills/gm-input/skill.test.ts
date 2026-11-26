import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { COMMANDS_DIR, checkSkill, loadCommands } from '@ogm/gm-cli';
import { actionFrameSchema, type ActionFrame } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

const SKILL = fileURLToPath(new URL('./SKILL.md', import.meta.url));
type DocumentedContracts = { ActionFrame: ActionFrame };
const sdkExports = { ActionFrame: actionFrameSchema.shape } satisfies Record<keyof DocumentedContracts, unknown>;

describe('gm-input skill', () => {
  it('stays short and teaches the current input contract', async () => {
    const text = readFileSync(SKILL, 'utf8');
    const commands = new Set((await loadCommands(COMMANDS_DIR)).keys());

    expect(text.trimEnd().split('\n').length).toBeLessThanOrEqual(80);
    expect(text).toContain('ActionFrame');
    expect(text).toContain('manifest.inputs.actions');
    expect(text).toContain('playerIndex');
    expect(text).toContain('host owns gamepad');
    expect(text).toContain('the touch overlay');
    /* The cross-device default (#600): phone buttons, laptop keyboard and gamepad, proven per game, never universal. */
    expect(text).toMatch(/phone with ordinary translucent on-screen buttons/);
    expect(text).toMatch(/keyboard\s+and a connected gamepad/);
    expect(text).toContain('up to five buttons');
    expect(text).toContain('`inputs.controls`');
    expect(text).toContain('games must not draw a controller');
    expect(text).not.toContain("`inputs.touch: 'self'`");
    expect(text).toContain('Never claim universal device support');
    expect(text).toContain('`phone-touch.json`');
    expect(text).toContain('`laptop-keys.json`');
    expect(text).toContain('injected standard gamepad');
    /* Controls drawn over a title cover its Play button (#1298): games pick each screen's layout. */
    expect(text).toContain('host.controls?.set({ layout })');
    expect(text).toMatch(/`'none'` on the\s+title \(players tap Play\), cutscenes/);
    /* A layout persists, so a game that hides controls on its title must ask for them back when play starts. */
    expect(text).toMatch(/`'gameplay'` \(the default\) when play starts/);
    expect(checkSkill(SKILL, { commands, sdkExports })).toEqual({ commands: [], sdk: [] });
  }, 30_000);
});
