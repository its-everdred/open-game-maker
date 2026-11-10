import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadIndex } from '@ogm/asset-cards';
import type { AssetsLock } from '@ogm/contracts';

import { creditForCard } from '../src/license-metadata.js';
import { MAP, ORC, SHEET, SHEET_META, SYNTY, WALL, preparedLibrary, useOrc } from './assets-fixture.js';
import { gm, tempDir } from './helpers.js';

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('gm assets use', () => {
  // D-ASSETS-REFERENCE: a game repo references library bytes by pack path and sha; it never carries them.
  it('references the library file without copying it and writes a valid lock and deterministic credits', async () => {
    const cwd = tempDir();
    const result = await useOrc(cwd, preparedLibrary());
    expect(result).toEqual({ code: 0, out: [], err: [] });
    expect(existsSync(join(cwd, 'assets'))).toBe(false);
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets).toEqual([
      expect.objectContaining({
        id: ORC,
        source: 'library',
        path: 'Models/GLB format/character-orc.glb',
        sha256: sha('orc-bytes'),
        license: 'CC0-1.0',
        credit: {
          pack: 'kenney-mini-dungeon',
          title: 'Mini Dungeon (Kenney)',
          licenseSource: 'License.txt',
          attribution: 'none required',
          source: { label: 'Kenney', url: 'https://assets.example/kenney-mini-dungeon' },
        },
      }),
    ]);
    expect(lock.assets[0]).not.toHaveProperty('files');
    expect(readFileSync(join(cwd, 'CREDITS.md'), 'utf8')).toContain('CC0 assets from: kenney-mini-dungeon');
  });

  it('falls back to explicit card metadata when pack.json is absent', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    rmSync(join(root, 'packs/kenney-mini-dungeon/pack.json'));

    const result = await useOrc(cwd, root);

    expect(result.code).toBe(0);
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets[0]?.credit).toMatchObject({
      licenseSource: 'License.txt',
      attribution: 'none required',
      source: { label: 'kenney' },
    });
  });

  it('fills missing manifest credit fields from the collection card', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    const path = join(root, 'packs/kenney-mini-dungeon/pack.json');
    writeFileSync(
      path,
      JSON.stringify({
        id: 'kenney-mini-dungeon',
        vendor: 'legacy-vendor',
        title: 'Legacy Mini Dungeon',
        license: 'CC0-1.0',
      }),
    );

    const result = await useOrc(cwd, root);

    expect(result).toEqual({ code: 0, out: [], err: [] });
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets[0]?.credit).toEqual({
      pack: 'kenney-mini-dungeon',
      title: 'Mini Dungeon (Kenney)',
      licenseSource: 'License.txt',
      attribution: 'none required',
      source: { label: 'kenney' },
    });
    expect(readFileSync(join(cwd, 'CREDITS.md'), 'utf8')).toContain(
      '## CC0-1.0\n- CC0 assets from: kenney-mini-dungeon\n- Mini Dungeon (Kenney) — none required (licence: License.txt)',
    );

    const precedenceCwd = tempDir();
    const precedenceRoot = preparedLibrary();
    writeFileSync(
      join(precedenceRoot, 'packs/kenney-mini-dungeon/pack.json'),
      JSON.stringify({
        license: 'CC0-1.0',
        license_source: 'Pack-License.txt',
        attribution: 'Pack attribution',
        source: { label: 'Pack source' },
      }),
    );
    expect(await useOrc(precedenceCwd, precedenceRoot)).toEqual({ code: 0, out: [], err: [] });
    const precedenceLock = JSON.parse(readFileSync(join(precedenceCwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(precedenceLock.assets[0]?.credit).toMatchObject({
      licenseSource: 'Pack-License.txt',
      attribution: 'Pack attribution',
      source: { label: 'Pack source' },
    });

    const invalidFields: Array<{ pack: Record<string, unknown>; field: string }> = [
      { pack: { license: '' }, field: 'license' },
      { pack: { license: 'CC0-1.0', license_source: null }, field: 'license_source' },
      { pack: { license: 'CC0-1.0', attribution: ' ' }, field: 'attribution' },
      { pack: { license: 'CC0-1.0', source: null }, field: 'source' },
    ];
    for (const { pack, field } of invalidFields) {
      const invalidCwd = tempDir();
      const invalidRoot = preparedLibrary();
      writeFileSync(join(invalidRoot, 'packs/kenney-mini-dungeon/pack.json'), JSON.stringify(pack));

      const invalid = await useOrc(invalidCwd, invalidRoot);

      expect(invalid.code).toBe(2);
      expect(invalid.err.join('\n')).toContain(`credit metadata is missing ${field}`);
      expect(existsSync(join(invalidCwd, 'assets.lock.json'))).toBe(false);
    }

    const malformedCwd = tempDir();
    const malformedRoot = preparedLibrary();
    writeFileSync(join(malformedRoot, 'packs/kenney-mini-dungeon/pack.json'), '{');

    const malformed = await useOrc(malformedCwd, malformedRoot);

    expect(malformed.code).toBe(2);
    expect(malformed.err.join('\n')).toContain(`${ORC}  missing-license-metadata`);
    expect(existsSync(join(malformedCwd, 'assets.lock.json'))).toBe(false);
  });

  it('names the field still missing after combining manifest and card metadata', async () => {
    const root = preparedLibrary();
    const packPath = join(root, 'packs/kenney-mini-dungeon/pack.json');
    writeFileSync(packPath, JSON.stringify({ license: 'CC0-1.0' }));
    const index = await loadIndex(root);
    const card = index.cards.find((candidate) => candidate.id === ORC);
    const sourceCollection = index.collections['t1:kenney-mini-dungeon@2.0'];
    if (card === undefined || sourceCollection === undefined) throw new Error('fixture card collection is missing');
    const collection = structuredClone(sourceCollection);
    delete collection.rights!.basis[0]!.ref;

    const result = await creditForCard(root, card, collection);

    expect(result.credit).toBeUndefined();
    expect(result.detail).toBe('credit metadata is missing license_source');
  });

  it('still rejects a manifest licence that differs from the card', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    const path = join(root, 'packs/kenney-mini-dungeon/pack.json');
    writeFileSync(path, JSON.stringify({ license: 'CC-BY-4.0' }));

    const result = await useOrc(cwd, root);

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('credit metadata license CC-BY-4.0 differs from CC0-1.0');
    expect(existsSync(join(cwd, 'assets.lock.json'))).toBe(false);
  });

  it('copies card metadata into the lock without changing it', async () => {
    const cwd = tempDir();
    const result = await gm(['assets', 'use', SHEET, '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: preparedLibrary() },
    });

    expect(result).toEqual({ code: 0, out: [], err: [] });
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets[0]?.meta).toEqual(SHEET_META);
  });

  it('refuses inspiration-only rights without writing any game files', async () => {
    const cwd = tempDir();
    const result = await gm(['assets', 'use', MAP, '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: preparedLibrary() },
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain(`${MAP}  no-redistribution`);
    expect(result.err.join('\n')).toContain('Try: gm assets why');
    expect(() => readFileSync(join(cwd, 'assets.lock.json'))).toThrow();
  });

  it('keeps a mixed refused batch atomic and accepts ids from -f', async () => {
    const root = preparedLibrary();
    const refusedCwd = tempDir();
    const refused = await gm(['assets', 'use', ORC, MAP, '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd: refusedCwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(refused.code).toBe(2);
    expect(() => readFileSync(join(refusedCwd, 'assets.lock.json'))).toThrow();

    const cwd = tempDir();
    writeFileSync(join(cwd, 'picks.txt'), `# starter\n${ORC}\n`);
    const picked = await gm(['assets', 'use', '-f', 'picks.txt', '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(picked.code).toBe(0);
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets.map((entry) => entry.id)).toEqual([ORC]);
  });

  it('pins listed texture companions by sha and writes accepted ids with --partial', async () => {
    const root = preparedLibrary();
    const companionCwd = tempDir();
    const companion = await gm(['assets', 'use', WALL, '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd: companionCwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(companion.code).toBe(0);
    expect(existsSync(join(companionCwd, 'assets'))).toBe(false);
    const companionLock = JSON.parse(readFileSync(join(companionCwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(companionLock.assets[0]).toMatchObject({
      path: 'Models/GLB format/wall.glb',
      sha256: sha('wall-bytes'),
      files: [{ path: 'Models/GLB format/Textures/colormap.png', sha256: sha('map-bytes') }],
    });

    const partialCwd = tempDir();
    const partial = await gm(['assets', 'use', ORC, MAP, '--partial', '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd: partialCwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(partial.code).toBe(2);
    const lock = JSON.parse(readFileSync(join(partialCwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets.map((entry) => entry.id)).toEqual([ORC]);
  });

  it('copies the primary and its companions into the repo only with --vendor', async () => {
    const cwd = tempDir();
    const result = await gm(['assets', 'use', WALL, '--vendor', '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: preparedLibrary() },
    });
    expect(result).toEqual({ code: 0, out: [], err: [] });
    expect(readFileSync(join(cwd, 'assets/model/kenney-mini-dungeon/wall.glb'), 'utf8')).toBe('wall-bytes');
    expect(readFileSync(join(cwd, 'assets/model/kenney-mini-dungeon/colormap.png'), 'utf8')).toBe('map-bytes');
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets[0]).toMatchObject({
      source: 'vendored',
      path: 'assets/model/kenney-mini-dungeon/wall.glb',
      sha256: sha('wall-bytes'),
      files: [{ path: 'assets/model/kenney-mini-dungeon/colormap.png', sha256: sha('map-bytes') }],
    });
  });

  it('deletes the repo copies of a vendored id when it becomes a library reference', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await gm(['assets', 'use', WALL, '--vendor', '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    const referenced = await gm(['assets', 'use', WALL], { cwd, env: { OGM_ASSETS_ROOT: root } });
    expect(referenced.code).toBe(0);
    expect(existsSync(join(cwd, 'assets/model/kenney-mini-dungeon/wall.glb'))).toBe(false);
    expect(existsSync(join(cwd, 'assets/model/kenney-mini-dungeon/colormap.png'))).toBe(false);
    expect((await gm(['check', 'assets'], { cwd, env: { OGM_ASSETS_ROOT: root } })).code).toBe(0);
  });

  // Vendoring flattens files into one folder; two files with one name would leave a lock pinning bytes it lost.
  it('refuses to vendor a card whose files share a name without copying anything', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    const cardPath = join(root, 'packs/kenney-mini-dungeon/cards/wall.card.json');
    const card = JSON.parse(readFileSync(cardPath, 'utf8')) as { source: { files: Array<Record<string, unknown>> } };
    card.source.files.push({ ...card.source.files[1], path: 'Models/OBJ format/Textures/colormap.png' });
    writeFileSync(cardPath, `${JSON.stringify(card, null, 2)}\n`);
    mkdirSync(join(root, 'packs/kenney-mini-dungeon/2.0/extracted/Models/OBJ format/Textures'), { recursive: true });
    writeFileSync(join(root, 'packs/kenney-mini-dungeon/2.0/extracted/Models/OBJ format/Textures/colormap.png'), 'obj');
    rmSync(join(root, 'index'), { recursive: true, force: true });

    const result = await gm(['assets', 'use', WALL, '--vendor', '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain(`${WALL}  name-collision`);
    expect(existsSync(join(cwd, 'assets'))).toBe(false);
    expect(existsSync(join(cwd, 'assets.lock.json'))).toBe(false);
  });

  it('refuses to vendor a second card whose file would overwrite different vendored bytes', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    const cardPath = join(root, 'packs/kenney-mini-dungeon/cards/character-orc.card.json');
    const card = JSON.parse(readFileSync(cardPath, 'utf8')) as { source: { files: Array<Record<string, unknown>> } };
    card.source.files.push({ ...card.source.files[0], path: 'Models/OBJ format/colormap.png', role: 'texture' });
    writeFileSync(cardPath, `${JSON.stringify(card, null, 2)}\n`);
    mkdirSync(join(root, 'packs/kenney-mini-dungeon/2.0/extracted/Models/OBJ format'), { recursive: true });
    writeFileSync(join(root, 'packs/kenney-mini-dungeon/2.0/extracted/Models/OBJ format/colormap.png'), 'orc-map');
    rmSync(join(root, 'index'), { recursive: true, force: true });
    const env = { OGM_ASSETS_ROOT: root };
    await gm(['assets', 'use', WALL, '--vendor', '--family', 'chunky-low-poly', '--pov', 'iso'], { cwd, env });

    const result = await gm(['assets', 'use', ORC, '--vendor'], { cwd, env });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain(`${ORC}  name-collision`);
    expect(readFileSync(join(cwd, 'assets/model/kenney-mini-dungeon/colormap.png'), 'utf8')).toBe('map-bytes');
  });

  it('keeps a vendored copy edited since vendoring when the id becomes a library reference', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await gm(['assets', 'use', WALL, '--vendor', '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    writeFileSync(join(cwd, 'assets/model/kenney-mini-dungeon/colormap.png'), 'recoloured');
    expect((await gm(['assets', 'use', WALL], { cwd, env: { OGM_ASSETS_ROOT: root } })).code).toBe(0);
    expect(readFileSync(join(cwd, 'assets/model/kenney-mini-dungeon/colormap.png'), 'utf8')).toBe('recoloured');
    expect(existsSync(join(cwd, 'assets/model/kenney-mini-dungeon/wall.glb'))).toBe(false);
  });

  // Build-only redistribution lets the bytes ship inside a built game, never as files in a repo.
  it('refuses to vendor an asset whose rights allow redistribution only in a build', async () => {
    const cwd = tempDir();
    const result = await gm(['assets', 'use', SYNTY, '--vendor', '--family', 'detailed-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: preparedLibrary() },
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain(`${SYNTY}  no-redistribution`);
    expect(existsSync(join(cwd, 'assets'))).toBe(false);
    expect(existsSync(join(cwd, 'assets.lock.json'))).toBe(false);
  });

  it('still refuses a non-redistributable id in a public repo even though nothing is copied', async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, '.gm'));
    writeFileSync(join(cwd, '.gm/game.json'), '{"visibility":"public"}\n');
    const result = await gm(['assets', 'use', MAP, '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: preparedLibrary() },
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain(`${MAP}  no-redistribution`);
    expect(existsSync(join(cwd, 'assets.lock.json'))).toBe(false);
  });

  it('refuses destination and registered-file symlinks that leave or disguise repo boundaries', async () => {
    const root = preparedLibrary();
    const outside = tempDir();
    const useCwd = tempDir();
    symlinkSync(outside, join(useCwd, 'assets'));
    const used = await gm(['assets', 'use', ORC, '--vendor', '--family', 'chunky-low-poly', '--pov', 'iso'], {
      cwd: useCwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(used.code).toBe(2);
    expect(() => readFileSync(join(outside, 'model/kenney-mini-dungeon/character-orc.glb'))).toThrow();

    const registerCwd = tempDir();
    await useOrc(registerCwd, root);
    mkdirSync(join(registerCwd, 'assets/model'), { recursive: true });
    const victim = join(outside, 'victim.glb');
    writeFileSync(victim, 'victim');
    const linked = join(registerCwd, 'assets/model/linked.glb');
    symlinkSync(victim, linked);
    const registered = await gm(
      ['assets', 'register', 'assets/model/linked.glb', '--made-by-agent', '--game', 'coin-hop'],
      { cwd: registerCwd, env: { OGM_ASSETS_ROOT: root } },
    );
    expect(registered.code).toBe(2);
    expect(readFileSync(victim, 'utf8')).toBe('victim');
  });

  it('requires and records a family exception before writing the lock', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    const events = join(cwd, 'events.jsonl');
    await useOrc(cwd, root);
    const refused = await gm(['assets', 'use', SYNTY], { cwd, env: { OGM_ASSETS_ROOT: root } });
    expect(refused.code).toBe(2);
    expect(refused.err.join('\n')).toContain('family-mismatch');
    const empty = await gm(['assets', 'use', SYNTY, '--exception='], {
      cwd,
      env: { OGM_ASSETS_ROOT: root },
    });
    expect(empty.code).toBe(2);
    expect(empty.err).toContain(
      '--exception needs a reason. Try: gm assets use <id> --exception "intentional contrast"',
    );
    const accepted = await gm(['assets', 'use', SYNTY, '--exception', 'intentional contrast'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root, GM_EVENTS_FILE: events },
    });
    expect(accepted.code).toBe(0);
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets.find((entry) => entry.id === SYNTY)).toMatchObject({
      license: 'LicenseRef-synty-personal',
      credit: { licenseSource: 'Synty personal-use licence' },
    });
    const eventNames = readFileSync(events, 'utf8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { event: string }).event);
    expect(eventNames).toContain('assets.family_exception');
  });

  it('refuses private-audience bytes in a public game repo', async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, '.gm'));
    writeFileSync(join(cwd, '.gm/game.json'), '{"visibility":"public"}\n');
    const result = await gm(['assets', 'use', SYNTY, '--family', 'detailed-low-poly', '--pov', 'iso'], {
      cwd,
      env: { OGM_ASSETS_ROOT: preparedLibrary() },
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain(`${SYNTY}  private-in-public`);
    expect(() => readFileSync(join(cwd, 'assets.lock.json'))).toThrow();
  });

  it('refreshes existing lock rights from a rebuilt index and keeps the reference', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await useOrc(cwd, root);
    const collectionPath = join(root, 'packs/kenney-mini-dungeon/collection.card.json');
    const collection = JSON.parse(readFileSync(collectionPath, 'utf8')) as {
      rights: { audience: string; basis: Array<{ audience: string }> };
    };
    collection.rights.audience = 'private';
    collection.rights.basis[0]!.audience = 'private';
    writeFileSync(collectionPath, `${JSON.stringify(collection, null, 2)}\n`);
    rmSync(join(root, 'index'), { recursive: true, force: true });
    const result = await gm(['assets', 'use', '--refresh'], { cwd, env: { OGM_ASSETS_ROOT: root } });
    expect(result.code).toBe(0);
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets[0]).toMatchObject({
      rights: { audience: 'private' },
      source: 'library',
      path: 'Models/GLB format/character-orc.glb',
      sha256: sha('orc-bytes'),
    });
  });
});

describe('gm assets register and why', () => {
  it('registers an agent-made derivative with the intersection of source rights', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await useOrc(cwd, root);
    const generated = join(cwd, 'assets/model/boss-door.glb');
    mkdirSync(join(generated, '..'), { recursive: true });
    writeFileSync(generated, 'door-bytes');
    const result = await gm(
      [
        'assets',
        'register',
        'assets/model/boss-door.glb',
        '--made-by-agent',
        '--from',
        ORC,
        '--from',
        SYNTY,
        '--game',
        'coin-hop',
      ],
      { cwd, env: { OGM_ASSETS_ROOT: root, OGM_BLOB_ROOT: tempDir('gm-blobs-') } },
    );
    expect(result.code).toBe(0);
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets.find((entry) => entry.id.startsWith('t3:coin-hop/'))).toMatchObject({
      rights: { audience: 'private', redistribution: 'in-build' },
      derived_from: [ORC, SYNTY],
    });
  });

  it('gives a source-free agent output CC0-equivalent rights without claiming a CC0 licence', async () => {
    const cwd = tempDir();
    const root = preparedLibrary();
    await useOrc(cwd, root);
    const generated = join(cwd, 'assets/model/spark.glb');
    mkdirSync(join(generated, '..'), { recursive: true });
    writeFileSync(generated, 'spark');
    const result = await gm(['assets', 'register', 'assets/model/spark.glb', '--made-by-agent', '--game', 'g_01J'], {
      cwd,
      env: { OGM_ASSETS_ROOT: root, OGM_BLOB_ROOT: tempDir('gm-blobs-') },
    });
    expect(result.code).toBe(0);
    const lock = JSON.parse(readFileSync(join(cwd, 'assets.lock.json'), 'utf8')) as AssetsLock;
    expect(lock.assets.find((entry) => entry.id === 't3:g_01J/model/spark')).toMatchObject({
      license: 'LicenseRef-made-by-agent',
      rights: { audience: 'public', redistribution: 'free' },
    });
  });

  it('explains effective rights, every basis row, and the public-repo verdict', async () => {
    const result = await gm(['assets', 'why', SYNTY], { env: { OGM_ASSETS_ROOT: preparedLibrary() } });
    expect(result.code).toBe(0);
    expect(result.out[0]).toContain('LicenseRef-synty-personal');
    expect(result.out.some((line) => line.startsWith('license  in-game,'))).toBe(true);
    expect(result.out).toContain('public repo: refused private-in-public');
  });
});
