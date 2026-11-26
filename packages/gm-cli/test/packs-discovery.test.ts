import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gm, library, tempDir } from './helpers.js';
import { filterLicensedItems } from '../src/packs/license-map.js';
import { discoverPacks, terminalText } from '../src/packs/discovery.js';
import { buildIndex } from '@ogm/asset-cards';
import { packMetadata, settingsFromNames } from '../src/packs/pack-metadata.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('pack discovery', () => {
  it('does not derive settings across unrelated names or from inn suffixes', () => {
    expect(settingsFromNames(['medieval', 'village', 'finn'])).toEqual([]);
    expect(settingsFromNames(['medieval-village', 'the_inn'])).toEqual(['medieval-village', 'tavern']);
  });
  it('uses the curated perspective of a known sprite set', () => {
    const card = packMetadata({
      id: 'limezu-modern-interiors',
      title: 'Modern Interiors',
      top: 'packs',
      version: '1',
      items: [{ kind: 'sprite', path: 'sprites/room.png' }],
      sceneSources: [],
      prefabSources: [],
    });
    expect(card.cameras).toEqual(['top-down']);
  });

  it('escapes terminal and direction controls in untrusted output', () => {
    expect(terminalText('scene\u001b]52;data\u202e')).toBe('scene\\u{1b}]52;data\\u{202e}');
  });
  it('records explicitly named 2D views and GLB scenes', () => {
    const card = packMetadata({
      id: 'new-pack',
      title: 'Top_Down Village',
      top: 'packs',
      version: '1',
      items: [{ kind: 'sprite', path: 'sprites/hero.png' }],
      sceneSources: ['scenes/demo.glb', 'village.umap'],
      prefabSources: [],
    });
    expect(card.cameras).toEqual(['top-down']);
    expect(card.scenes?.[0]).toMatchObject({ engine: 'glb', path: 'packs/new-pack/1/extracted/scenes/demo.glb' });
    expect(card.scenes?.[1]).toMatchObject({ engine: 'unreal', path: 'packs/new-pack/1/extracted/village.umap' });
  });
  it('does not offer collections without effective in-game rights', async () => {
    const root = library();
    roots.push(root);
    const index = await buildIndex(root);
    const card = index.collections['t1:kenney-mini-dungeon@2.0'];
    expect(card).toBeDefined();
    card!.resolved.rights.uses = ['vision-input'];
    expect(discoverPacks(index, {}).map((pack) => pack.id)).not.toContain(card!.id);
  }, 120_000);
  it('does not expose scene sources under a mixed-license collection', async () => {
    const root = tempDir('pack-scene-rights-');
    roots.push(root);
    await writeFile(join(root, 'scene.unity'), 'scene data');
    const dropped = await filterLicensedItems(
      root,
      [],
      { 'scene.unity': { license: 'CC-BY-4.0', attribution: 'Artist' } },
      ['scene.unity'],
    );
    expect(dropped).toContain('scene.unity: scene source needs per-file rights');
    await expect(readFile(join(root, 'scene.unity'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('indexes collection metadata and filters packs and scenes', async () => {
    const root = library();
    roots.push(root);
    const path = join(root, 'packs/kenney-mini-dungeon/collection.card.json');
    const card = JSON.parse(await readFile(path, 'utf8'));
    Object.assign(card, {
      style_family: 'isometric-2d',
      cameras: ['isometric'],
      settings: ['tavern'],
      scenes: [
        {
          path: 'packs/kenney-mini-dungeon/demo\u001b]52.unity',
          engine: 'unity',
          settings: ['tavern'],
          preview: 'previews/tavern\u202e.webp',
        },
        {
          path: 'packs/kenney-mini-dungeon/second.unity',
          engine: 'unity',
          settings: ['tavern'],
          preview: null,
        },
      ],
    });
    await writeFile(path, JSON.stringify(card));
    const env = { OGM_ASSETS_ROOT: root };
    const found = await gm(['packs', 'search', '--camera', 'isometric', '--setting', 'tavern', '--json'], { env });
    expect(found.code, found.err.join('\n')).toBe(0);
    expect(found.out.map((line) => JSON.parse(line).id)).toContain(card.id);
    const zeroPacks = await gm(['packs', 'search', '--setting', 'tavern', '--limit', '0', '--json'], { env });
    expect(zeroPacks.code, zeroPacks.err.join('\n')).toBe(0);
    expect(zeroPacks.out).toEqual([]);
    const styleHit = await gm(['packs', 'search', '--style', 'isometric-2d', '--json'], { env });
    expect(styleHit.code, styleHit.err.join('\n')).toBe(0);
    expect(styleHit.out.map((line) => JSON.parse(line).id)).toContain(card.id);
    for (const [flag, value] of [
      ['--style', 'pixel-art'],
      ['--setting', 'castle'],
    ] as const) {
      const result = await gm(['packs', 'search', flag, value, '--json'], { env });
      expect(result.code, result.err.join('\n')).toBe(0);
      expect(result.out.map((line) => JSON.parse(line).id)).not.toContain(card.id);
    }
    const missed = await gm(['packs', 'search', '--camera', 'first-person', '--style', 'isometric-2d', '--json'], {
      env,
    });
    expect(missed.out).toEqual([]);
    const scenes = await gm(['packs', 'scenes', '--setting', 'tavern', '--json'], { env });
    expect(scenes.code, scenes.err.join('\n')).toBe(0);
    expect(scenes.out.map((line) => JSON.parse(line))).toContainEqual({ pack: card.id, ...card.scenes[0] });
    const oneScene = await gm(['packs', 'scenes', '--setting', 'tavern', '--limit', '1', '--json'], { env });
    expect(oneScene.code, oneScene.err.join('\n')).toBe(0);
    expect(oneScene.out).toHaveLength(1);
    const otherScenes = await gm(['packs', 'scenes', '--setting', 'castle', '--json'], { env });
    expect(otherScenes.code, otherScenes.err.join('\n')).toBe(0);
    expect(otherScenes.out.map((line) => JSON.parse(line).pack)).not.toContain(card.id);
    expect(scenes.out.join('')).not.toContain('\u202e');
    expect(scenes.out.join('')).toContain('\\u202e');
    const terminal = await gm(['packs', 'scenes', '--setting', 'tavern'], { env });
    expect(terminal.out.join('')).not.toContain('\u001b');
    expect(terminal.out.join('')).toContain('\\u{1b}');
  }, 120_000);

  it('retains Unity scenes and prefabs on import', async () => {
    const root = tempDir('packs-discovery-');
    roots.push(root);
    const input = join(root, 'input');
    await mkdir(input);
    await writeFile(join(input, 'tavern.unity'), 'scene data');
    await writeFile(join(input, 'tavern.prefab'), 'prefab data');
    await writeFile(join(input, 'tavern.unity.meta'), 'guid: example');
    const result = await gm(
      [
        'packs',
        'import',
        input,
        '--id',
        'test-tavern',
        '--version',
        '1',
        '--style',
        'detailed-low-poly',
        '--cameras',
        'first-person,side',
        '--json',
      ],
      {
        env: { OGM_ASSETS_ROOT: root },
      },
    );
    expect(result.code, result.err.join('\n')).toBe(0);
    const card = JSON.parse(await readFile(join(root, 'packs/test-tavern/collection.card.json'), 'utf8'));
    expect(card.style_family).toBe('detailed-low-poly');
    expect(card.cameras).toEqual(['first-person', 'side']);
    expect(card.scenes).toEqual([
      { path: 'packs/test-tavern/1/extracted/tavern.unity', engine: 'unity', settings: ['tavern'], preview: null },
    ]);
    expect(card.prefabs).toEqual(['packs/test-tavern/1/extracted/tavern.prefab']);
    expect(await readFile(join(root, card.scenes[0].path), 'utf8')).toBe('scene data');
    expect(await readFile(join(root, `${card.scenes[0].path}.meta`), 'utf8')).toBe('guid: example');
    const mismatch = await gm(
      ['packs', 'import', input, '--id', 'test-tavern', '--version', '1', '--style', 'pixel-art'],
      { env: { OGM_ASSETS_ROOT: root } },
    );
    expect(mismatch.code).toBe(2);
    expect(mismatch.err.join('\n')).toContain('different discovery metadata');
    const invalid = await gm(['packs', 'import', input, '--id', 'other', '--style', ''], {
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(invalid.code).toBe(2);
    expect(invalid.err.join('\n')).toContain('unknown style family');
  }, 120_000);
});
