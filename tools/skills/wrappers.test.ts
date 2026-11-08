import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const skills = join(dirname(fileURLToPath(import.meta.url)), '../../skills');
const text = (skill: string) => readFileSync(join(skills, skill, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ');

/*
 * The vendored Sprite Forge and video-to-game texts route generation through paid providers (fal, provider keys,
 * `--route auto`). A worker reads the gm skill that names a tool, so Kevin's standing policy has to live there:
 * no fal, no provider key, no spending, ask before generating, no paid-pack references, the creator's own clip.
 */
describe('gm wrappers of the vendored tool sets', () => {
  it('gm-asset-variants names Sprite Forge and keeps generation keyless, asked for and free of paid packs', () => {
    const variants = text('gm-asset-variants');

    for (const tool of ['generate2dsprite', 'generate2dmap', 'video2dsprite', 'generate2dmedia']) {
      expect(variants).toContain(`\`${tool}\``);
      expect(existsSync(join(skills, 'vendor/sprite-forge', tool, 'SKILL.md')), tool).toBe(true);
    }
    expect(existsSync(join(skills, 'vendor/sprite-forge/generate2dsprite/scripts/palette_tool.py'))).toBe(true);
    expect(variants).toContain('No fal and no provider key: never add, set or ask for one, and never spend.');
    /* Sprite Forge's own default is "API key first"; master_still.py only forwards --route when given one. */
    expect(variants).toContain('Every command that generates an image passes `--route codex-cli`');
    expect(variants).toContain(
      "`generate2dmedia`'s `route_media.py image`, `master_still.py generate` and `master_still.py edit`",
    );
    expect(variants).toContain('never leave `--route` out, and skip any other command that would generate');
    /* sprite_set.py run calls route_media.py video with no --route for every action without a supplied clip. */
    expect(variants).toContain('never run `route_media.py video` or `sprite_set.py run`');
    expect(variants).toContain('`video2dsprite` only runs `video2dsprite.py process` on a clip the creator supplies');
    expect(variants).toContain("a configured key is the owner's consent");
    expect(variants).toContain('Ask the Executor before any generation');
    expect(variants).toContain('Never send a paid-pack asset to a cloud model as a reference');
  });

  it('the generating Sprite Forge skills point a worker who opens them directly at those rules', () => {
    for (const tool of ['generate2dsprite', 'generate2dmap', 'generate2dmedia', 'video2dsprite']) {
      const body = readFileSync(join(skills, 'vendor/sprite-forge', tool, 'SKILL.md'), 'utf8').split('\n---\n')[1]!;
      expect(body.trimStart().replace(/\s+/g, ' '), tool).toMatch(
        /^> Game Maker: before generating anything, follow the Sprite Forge rules in `\.claude\/skills\/gm-asset-variants\/SKILL\.md` > \(no provider key, `--route codex-cli` only, ask first\); they win over this text\./,
      );
    }
  });

  it('no gm skill or role row names a media route other than codex-cli, except to forbid it', () => {
    const files = readdirSync(skills)
      .filter((name) => name.startsWith('gm-') && existsSync(join(skills, name, 'SKILL.md')))
      .map((name) => join(name, 'SKILL.md'))
      .concat('gm-core/references/roles.md');
    for (const file of files) {
      const prose = readFileSync(join(skills, file), 'utf8').replace(/\s+/g, ' ');
      for (const m of prose.matchAll(/(\S+ \S+ )?`?--route[ =]`?([\w-]+)/g))
        if (m[2] !== 'codex-cli') expect(m[1], `${file}: --route ${m[2]}`).toMatch(/\bnever\b/i);
    }
  });

  it('gm-image-mock runs only the local video-to-game tools on a clip the creator supplies', () => {
    const mock = text('gm-image-mock');

    for (const script of ['study_video.py', 'side_by_side.py', 'best_window.py']) {
      expect(mock).toContain(script);
      expect(existsSync(join(skills, 'vendor/video-to-game/scripts', script)), script).toBe(true);
    }
    expect(mock).toContain('the creator supplies the clip; never generate, download or ask a model for one');
    expect(mock).toContain('No fal and no provider key: never add or ask for one.');
    expect(mock).toContain("Upstream's fal generation is not vendored");
  });

  it('gm-ui-hud names frontend-design and keeps it behind the approved targets and the Gruvbox palette', () => {
    const hud = text('gm-ui-hud');

    expect(hud).toContain('`.claude/skills/vendor/frontend-design/frontend-design/SKILL.md`');
    expect(existsSync(join(skills, 'vendor/frontend-design/frontend-design/SKILL.md'))).toBe(true);
    expect(hud).toContain("the game's approved targets");
    expect(hud).toContain("the app's Gruvbox palette win over its suggestions");
  });

  it('roles recommend Sprite Forge, video-to-game and frontend-design on the roles the ticket names', () => {
    const roles = readFileSync(join(skills, 'gm-core/references/roles.md'), 'utf8');
    const section = (role: string) => {
      const start = roles.indexOf(`### ${role}\n`);
      expect(start, role).toBeGreaterThanOrEqual(0);
      const next = roles.indexOf('\n### ', start + 1);
      return roles.slice(start, next === -1 ? undefined : next);
    };
    const expected: Record<string, string[]> = {
      'role:assets': [
        'sprite-forge/generate2dsprite/SKILL.md',
        'sprite-forge/generate2dmap/SKILL.md',
        'sprite-forge/video2dsprite/SKILL.md',
      ],
      'role:visual': [
        'sprite-forge/generate2dsprite/SKILL.md',
        'video-to-game/references/study-the-video.md',
        'frontend-design/frontend-design/SKILL.md',
      ],
      'role:game-design': ['video-to-game/references/study-the-video.md'],
    };
    for (const [role, paths] of Object.entries(expected)) {
      for (const path of paths) {
        expect(section(role), role).toContain(`\`vendor/${path}\``);
        expect(existsSync(join(skills, 'vendor', path)), path).toBe(true);
      }
    }
    expect(roles.replace(/\s+/g, ' ')).toContain(
      'ask the Executor before any generation, every generating call passes `--route codex-cli`, no provider key',
    );
  });
});
