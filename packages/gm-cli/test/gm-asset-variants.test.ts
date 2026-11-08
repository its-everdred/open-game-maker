import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkSkill, COMMANDS_DIR, loadCommands } from '../src/cli.js';

const SKILLS = fileURLToPath(new URL('../../../skills/', import.meta.url));
const FILE = `${SKILLS}/gm-asset-variants/SKILL.md`;

describe('gm-asset-variants ships to the build agents', () => {
  it('is routed from gm-core so a sandboxed worker finds it', () => {
    expect(readFileSync(`${SKILLS}/gm-core/SKILL.md`, 'utf8')).toContain('| gm-asset-variants |');
  });

  // Workers run in a sandbox with only the game repo and `gm`: research-repo paths, host paths and people's
  // names would point them at things they cannot reach (blobs #126 and #149).
  it('is sandbox-safe: no host paths, research-repo tools or names', () => {
    const text = readFileSync(FILE, 'utf8');

    expect(text).not.toMatch(/assets-local|scripts\/|apps\/|prototypes\/|title-town|\/home\/|~\/|Kevin/);
    expect(text).toContain('Never delete, edit, overwrite or re-save an original');
    expect(text).toContain('gm assets variant');
    expect(readFileSync(FILE, 'utf8').trimEnd().split('\n').length).toBeLessThanOrEqual(80);
  });

  it('names only gm commands that exist', async () => {
    const commands = new Set((await loadCommands(COMMANDS_DIR)).keys());

    expect(checkSkill(FILE, { commands, sdkExports: {} }).commands).toEqual([]);
  });
});
