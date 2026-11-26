import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import AdmZip from 'adm-zip';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { validateCard } from '@ogm/contracts';

import { gm, tempDir } from './helpers.js';

const temporary: string[] = [];

function fresh(prefix: string): string {
  const path = tempDir(prefix);
  temporary.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function unknownFixture(): Promise<string> {
  const input = fresh('gm-pack-input-');
  await mkdir(join(input, 'Textures'));
  await writeFile(join(input, 'wall.obj'), 'o wall\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ff00ffff' } })
    .png()
    .toFile(join(input, 'Textures', 'wall.png'));
  return input;
}

describe('gm packs import', () => {
  it('accepts an identical legacy source but rejects changed scene content', async () => {
    const assets = fresh('gm-pack-legacy-assets-');
    const input = await unknownFixture();
    await writeFile(join(input, 'scene.unity'), 'original scene');
    await writeFile(join(input, 'prop.prefab'), 'original prefab');
    const env = { OGM_ASSETS_ROOT: assets };
    const args = ['packs', 'import', input, '--id', 'legacy-test', '--version', '1', '--json'];
    const first = await gm(args, { env });
    expect(first.code, first.err.join('\n')).toBe(0);
    const hashPath = join(assets, 'packs', 'legacy-test', '1', 'hash-manifest.txt');
    const manifest = await readFile(hashPath, 'utf8');
    const legacy = manifest.split('\n').filter((line) => line && !/\.(unity|prefab|umap|meta)$/i.test(line));
    await writeFile(hashPath, `${legacy.join('\n')}\n`);
    const again = await gm(args, { env });
    expect(again.code, again.err.join('\n')).toBe(0);
    const installed = join(assets, 'packs', 'legacy-test', '1', 'extracted');
    await rm(join(installed, 'scene.unity'));
    await rm(join(installed, 'prop.prefab'));
    const newer = await gm(['packs', 'import', input, '--id', 'legacy-test', '--version', '2', '--json'], { env });
    expect(newer.code, newer.err.join('\n')).toBe(0);
    const restored = await gm(args, { env });
    expect(restored.code, restored.err.join('\n')).toBe(0);
    const card = JSON.parse(await readFile(join(assets, 'packs', 'legacy-test', 'collection.card.json'), 'utf8'));
    expect(card.id).toBe('t1:legacy-test@1');
    expect(card.scenes).toEqual([]);
    expect(card.prefabs).toEqual([]);
    expect(await readFile(hashPath, 'utf8')).toBe(`${legacy.join('\n')}\n`);
    await writeFile(join(input, 'scene.unity'), 'changed scene');
    const changed = await gm(args, { env });
    expect(changed.code).toBe(2);
    expect(changed.err.join('\n')).toContain('already exists with different content');
  }, 120_000);

  it('writes a valid, stable collection that remains hidden while quarantined', async () => {
    const assets = fresh('gm-pack-assets-');
    const input = await unknownFixture();
    const env = { OGM_ASSETS_ROOT: assets };
    const first = await gm(['packs', 'import', input, '--id', 'vendor-test', '--version', '1', '--json'], { env });
    expect(first.code, first.err.join('\n')).toBe(0);
    const summary = JSON.parse(first.out[0]) as { collection: string; cards: number; status: string };
    expect(summary).toMatchObject({ collection: 't1:vendor-test@1', cards: 2, status: 'quarantined' });

    const pack = join(assets, 'packs', 'vendor-test');
    await expect(stat(join(pack, '1', 'originals', 'wall.obj'))).resolves.toBeTruthy();
    await expect(stat(join(pack, '1', 'extracted', 'wall.obj'))).resolves.toBeTruthy();
    const collection = JSON.parse(await readFile(join(pack, 'collection.card.json'), 'utf8'));
    expect(collection.collection_info).not.toHaveProperty('creation_choice');
    expect(collection.collection_info.files_total).toBe(2);
    expect(validateCard(collection)).toMatchObject({ ok: true });
    for (const name of await readdir(join(pack, 'cards'))) {
      const card = JSON.parse(await readFile(join(pack, 'cards', name), 'utf8'));
      const validation = validateCard(card);
      expect(validation.ok ? [] : validation.errors, name).toEqual([]);
    }
    const before = await readFile(join(pack, 'collection.card.json'), 'utf8');
    const beforePack = await readFile(join(pack, 'pack.json'), 'utf8');
    const beforeCard = await readFile(join(pack, 'cards', 'wall.card.json'), 'utf8');

    const second = await gm(['packs', 'import', input, '--id', 'vendor-test', '--version', '1', '--json'], { env });
    expect(second.code).toBe(0);
    expect(await readFile(join(pack, 'collection.card.json'), 'utf8')).toBe(before);
    expect(await readFile(join(pack, 'pack.json'), 'utf8')).toBe(beforePack);
    expect(await readFile(join(pack, 'cards', 'wall.card.json'), 'utf8')).toBe(beforeCard);

    const search = await gm(['assets', 'search', '--include-draft', '--collection', 't1:vendor-test@1', '--json'], {
      env,
    });
    expect(search.out).toEqual([]);
  });

  it('imports a folder of archives whose members share names', async () => {
    // Real Drive drops are folders of several vendor zips, each with its own readme and license file.
    const assets = fresh('gm-pack-assets-');
    const input = fresh('gm-pack-input-');
    await mkdir(join(input, 'new packs'));
    for (const name of ['Orcs', 'Demons']) {
      const zip = new AdmZip();
      zip.addFile('readme.txt', Buffer.from(name));
      zip.addFile(`${name.toLowerCase()}.obj`, Buffer.from('o mesh\n'));
      await writeFile(join(input, 'new packs', `${name}.zip`), zip.toBuffer());
    }

    const result = await gm(['packs', 'import', input, '--id', 'multi-zip', '--version', '1', '--json'], {
      env: { OGM_ASSETS_ROOT: assets },
    });

    expect(result.code, result.err.join('\n')).toBe(0);
    const extracted = join(assets, 'packs', 'multi-zip', '1', 'extracted', 'new packs');
    expect(await readFile(join(extracted, 'Orcs', 'readme.txt'), 'utf8')).toBe('Orcs');
    expect(await readFile(join(extracted, 'Demons', 'readme.txt'), 'utf8')).toBe('Demons');
  });

  it('confirms a collection with measured assets as measured', async () => {
    // The ticket's confirm step lands on `measured` when measurement ran, so default search shows measured kinds.
    const assets = fresh('gm-pack-assets-');
    const env = { OGM_ASSETS_ROOT: assets };
    expect(
      (await gm(['packs', 'import', await unknownFixture(), '--id', 'measured-test', '--version', '1'], { env })).code,
    ).toBe(0);

    const confirm = await gm(
      ['packs', 'import', '--confirm', 't1:measured-test@1', '--license', 'CC0-1.0', '--confirmed-by', 'kevin'],
      { env },
    );

    expect(confirm.code, confirm.err.join('\n')).toBe(0);
    const collection = JSON.parse(
      await readFile(join(assets, 'packs', 'measured-test', 'collection.card.json'), 'utf8'),
    );
    expect(collection.status).toBe('measured');
  });

  it('never confirms a licence from evidence inside the drop', async () => {
    // Anyone can put a CC0 note or a Synty folder layout in a drop; only --license (or --confirm) may widen rights.
    const assets = fresh('gm-pack-assets-');
    const input = await unknownFixture();
    await writeFile(join(input, 'License.txt'), 'Kenney assets are licensed CC0 1.0.');
    await mkdir(join(input, 'SourceFiles'));
    await writeFile(join(input, 'SourceFiles', 'readme.txt'), 'Synty-style layout');
    const env = { OGM_ASSETS_ROOT: assets };

    const result = await gm(['packs', 'import', input, '--id', 'lookalike', '--version', '1', '--json'], { env });

    expect(result.code, result.err.join('\n')).toBe(0);
    expect(JSON.parse(result.out[0])).toMatchObject({ status: 'quarantined', license: null, confirmed_by: null });
    const collection = JSON.parse(await readFile(join(assets, 'packs', 'lookalike', 'collection.card.json'), 'utf8'));
    expect(collection).toMatchObject({ status: 'quarantined', license: 'NOASSERTION' });
  });

  it('publishes only cards from the current version while preserving old originals', async () => {
    const assets = fresh('gm-pack-assets-');
    const firstInput = fresh('gm-pack-input-');
    const secondInput = fresh('gm-pack-input-');
    await writeFile(join(firstInput, 'wall.obj'), 'o wall\n');
    await writeFile(join(secondInput, 'floor.obj'), 'o floor\n');
    const env = { OGM_ASSETS_ROOT: assets };

    expect((await gm(['packs', 'import', firstInput, '--id', 'versioned', '--version', '1'], { env })).code).toBe(0);
    expect((await gm(['packs', 'import', secondInput, '--id', 'versioned', '--version', '2'], { env })).code).toBe(0);

    const pack = join(assets, 'packs', 'versioned');
    expect((await readdir(join(pack, 'cards'))).sort()).toEqual(['floor.card.json']);
    await expect(stat(join(pack, '1', 'originals', 'wall.obj'))).resolves.toBeTruthy();
    await expect(stat(join(pack, '2', 'originals', 'floor.obj'))).resolves.toBeTruthy();
  });

  it('refuses symlinked files in a direct source tree', async () => {
    const assets = fresh('gm-pack-assets-');
    const input = fresh('gm-pack-input-');
    const outside = join(fresh('gm-pack-outside-'), 'outside.obj');
    await writeFile(outside, 'o outside\n');
    await symlink(outside, join(input, 'linked.obj'));

    const result = await gm(['packs', 'import', input, '--id', 'linked-pack', '--version', '1'], {
      env: { OGM_ASSETS_ROOT: assets },
    });

    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('links are not allowed');
    await expect(stat(join(assets, 'packs', 'linked-pack'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a bad queue manifest before writing collection files', async () => {
    const assets = fresh('gm-pack-queue-');
    const quarantine = join(assets, 'inbox', 'quarantine', 'bad-drop');
    await mkdir(join(quarantine, 'files'), { recursive: true });
    await writeFile(
      join(quarantine, 'manifest.json'),
      JSON.stringify({
        drop_id: 'drop-bad',
        name: 'Bad',
        integrity_ok: false,
        problems: ['checksum mismatch'],
        files: [],
      }),
    );
    await writeFile(
      join(assets, 'inbox', 'queue.jsonl'),
      `${JSON.stringify({ drop_id: 'drop-bad', name: 'Bad', manifest: 'quarantine/bad-drop/manifest.json' })}\n`,
    );

    const result = await gm(['packs', 'import', '--from-queue', 'drop-bad', '--id', 'drive-bad', '--json'], {
      env: { OGM_ASSETS_ROOT: assets },
    });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('integrity');
    await expect(stat(join(assets, 'packs', 'drive-bad'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('confirms a quarantined collection with a named human and updates intake state', async () => {
    const assets = fresh('gm-pack-confirm-');
    const quarantine = join(assets, 'inbox', 'quarantine', 'confirm-drop');
    await mkdir(join(quarantine, 'files'), { recursive: true });
    await writeFile(join(quarantine, 'files', 'wall.obj'), 'o wall\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    await writeFile(
      join(quarantine, 'manifest.json'),
      JSON.stringify({
        drop_id: 'drop-confirm',
        name: 'Confirm Test',
        revision: 1,
        downloaded_at: '2026-10-26T10:00:00Z',
        files_root: 'quarantine/confirm-drop/files',
        files: [{ path: 'wall.obj', downloaded: true }],
        integrity_ok: true,
        problems: [],
      }),
    );
    await writeFile(
      join(assets, 'inbox', 'queue.jsonl'),
      `${JSON.stringify({ drop_id: 'drop-confirm', name: 'Confirm Test', manifest: 'quarantine/confirm-drop/manifest.json' })}\n`,
    );
    const env = { OGM_ASSETS_ROOT: assets };
    const imported = await gm(
      ['packs', 'import', '--from-queue', 'drop-confirm', '--id', 'confirm-test', '--version', '1', '--json'],
      { env },
    );
    expect(imported.code, imported.err.join('\n')).toBe(0);
    const before = JSON.parse(await readFile(join(quarantine, 'intake.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(before).sort()).toEqual(['collection', 'confirmed_by', 'date', 'license', 'rights', 'status']);
    expect(before).toMatchObject({ status: 'awaiting-license', license: null, confirmed_by: null, date: '2026-10-26' });
    expect(before.rights).toMatchObject({ processing: 'local-only' });

    const result = await gm(
      [
        'packs',
        'import',
        '--confirm',
        't1:confirm-test@1',
        '--license',
        'CC0-1.0',
        '--confirmed-by',
        'kevin',
        '--json',
      ],
      { env },
    );
    expect(result.code, result.err.join('\n')).toBe(0);
    const card = JSON.parse(await readFile(join(assets, 'packs', 'confirm-test', 'collection.card.json'), 'utf8'));
    expect(card).toMatchObject({ status: 'draft', license: 'CC0-1.0', rights: { processing: 'any' } });
    expect(card.rights.basis[0]).toMatchObject({ type: 'license', confirmed_by: 'kevin' });
    expect(JSON.parse(await readFile(join(assets, 'packs', 'confirm-test', 'pack.json'), 'utf8'))).toMatchObject({
      license: 'CC0-1.0',
      license_source: 'License.txt',
    });
    const intake = JSON.parse(await readFile(join(quarantine, 'intake.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(intake).sort()).toEqual(['collection', 'confirmed_by', 'date', 'license', 'rights', 'status']);
    expect(intake).toMatchObject({ status: 'imported', license: 'CC0-1.0', confirmed_by: 'kevin' });
    expect(intake.rights).toMatchObject({ processing: 'any' });
    const search = await gm(['assets', 'search', '--include-draft', '--collection', 't1:confirm-test@1', '--json'], {
      env,
    });
    expect(search.out.map((line) => (JSON.parse(line) as { id: string }).id)).toContain('t1:confirm-test/wall@1');
    expect(
      search.out.map((line) => {
        const hit = JSON.parse(line) as { id: string; collection?: string };
        return hit.collection ?? hit.id;
      }),
    ).toContain('t1:confirm-test@1');
  });
});
