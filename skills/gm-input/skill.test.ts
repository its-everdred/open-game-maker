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
    expect(text).toContain('host owns the touch overlay');
    expect(checkSkill(SKILL, { commands, sdkExports })).toEqual({ commands: [], sdk: [] });
  });
});
