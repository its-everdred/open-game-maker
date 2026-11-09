import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMANDS_DIR, checkSkill, loadCommands } from '@ogm/gm-cli';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, 'SKILL.md');
const DESIGN = join(HERE, '../gm-new-game-design/SKILL.md');
const SPEC = join(HERE, '../gm-new-game-design/references/spec-template.md');
const ROLES = join(HERE, '../gm-core/references/roles.md');
const DECISIONS = join(HERE, '../../docs/spec/game-maker-2000-v0.5-decisions.md');
const NEW_ROUTE = join(HERE, '../../apps/web/src/routes/new');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('agent-only map building', () => {
  it('searches every inspiration layout, retrieves its graph, and renders it with the chosen visual set', async () => {
    const text = read(SKILL);
    const commands = new Set((await loadCommands(COMMANDS_DIR)).keys());

    expect(text.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
    expect(text).toContain('gm maps search --maps');
    expect(text).toContain('gm maps info <map-id> --json');
    expect(text).toContain('gm maps search --tilesets --type <style-set>');
    expect(text).toContain('`gm.lock.json`');
    expect(text).toContain('all inspiration collections');
    expect(text).toContain('first map');
    expect(text).toContain('reachability');
    expect(text).toContain('gm build');
    expect(text).toContain('source layout id');
    expect(text).toContain('tileset card id');
    expect(text).not.toContain('gm decide');
    expect(checkSkill(SKILL, { commands, sdkExports: {} })).toEqual({ commands: [], sdk: [] });
  });

  it('keeps map sources and tilesets out of every creator-facing creation choice', () => {
    const design = read(DESIGN);
    const spec = read(SPEC);
    const route = readdirSync(NEW_ROUTE, { recursive: true })
      .map((path) => path.toString())
      .filter((path) => /\.(?:ts|tsx)$/.test(path))
      .map((path) => read(join(NEW_ROUTE, path)))
      .join('\n');

    expect(design).toContain('Never ask the creator to choose a map source, map pack or tileset');
    expect(spec).not.toContain('Map sources');
    expect(spec).toContain('Map needs (biome, features, scale)');
    expect(route).not.toMatch(/map[ -]pack|tileset/i);
  });

  it('routes gameplay tickets through the skill and records the durable decision', () => {
    expect(read(ROLES)).toContain('gm-core, gm-input, gm-verify, gm-qa, gm-map-inspiration');
    expect(read(DECISIONS)).toContain('D-MAPS-AGENT-ONLY');
  });
});
