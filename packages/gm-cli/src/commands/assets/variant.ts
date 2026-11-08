import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

import type { Document, Node } from '@gltf-transform/core';
import { mergeDocuments, unpartition } from '@gltf-transform/functions';
import { loadIndex } from '@ogm/asset-cards';
import type { LockEntry } from '@ogm/contracts';

import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { requireAssetsRoot } from '../../context.js';
import { readLock } from '../../lock.js';
import { resolveEntry, type Locations } from '../../resolve.js';
import { gltfIo, readyMeshopt } from '../build/assets/gltf.js';
import { registerFile, repeated } from './register.js';

const USAGE = 'gm assets variant <id> --name <slug> [--recolour <material>=#rrggbb] [--prop <id>@<slot|joint>]';

type Recolour = { material: string; factor: [number, number, number, number] };
type Prop = { id: string; at: string };

/** glTF colour factors are linear; the creator's palette is sRGB hex. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseRecolour(value: string): Recolour {
  const match = /^(.+)=#([0-9a-f]{6})$/i.exec(value);
  if (!match) throw new UsageError(`--recolour ${value} is not <material>=#rrggbb`, USAGE);
  const hex = match[2]!;
  const [r, g, b] = [0, 2, 4].map((at) => linear(Number.parseInt(hex.slice(at, at + 2), 16)));
  return { material: match[1]!, factor: [r!, g!, b!, 1] };
}

function parseProp(value: string): Prop {
  const at = value.lastIndexOf('@');
  /* Library ids carry their own `@version`, so the attach point is after the last `@`. */
  if (at <= 0 || at === value.length - 1) {
    throw new UsageError(`--prop ${value} is not <id>@<slot|joint>`, USAGE);
  }
  return { id: value.slice(0, at), at: value.slice(at + 1) };
}

function lockedGlb(lock: { assets: LockEntry[] }, id: string): LockEntry {
  const entry = lock.assets.find((candidate) => candidate.id === id);
  if (!entry) throw new UsageError(`${id} is not in assets.lock.json`, `gm assets use ${id}`);
  if (extname(entry.path).toLowerCase() !== '.glb') {
    throw new UsageError(`${id} is not a .glb model`, 'gm assets search --kind model');
  }
  return entry;
}

async function readLocked(entry: LockEntry, where: Locations): Promise<Document> {
  const resolution = await resolveEntry(entry, where);
  if (!resolution.ok) throw new UsageError(`${entry.id}: ${resolution.detail}`, resolution.fix);
  return gltfIo().read(resolution.primary);
}

function recolour(document: Document, change: Recolour): void {
  const materials = document
    .getRoot()
    .listMaterials()
    .filter((material) => change.material === '*' || material.getName() === change.material);
  if (materials.length === 0) {
    const names = document
      .getRoot()
      .listMaterials()
      .map((material) => material.getName());
    throw new UsageError(`no material named ${change.material}`, `one of: ${names.join(', ') || '(none)'}`);
  }
  for (const material of materials) {
    const [r, g, b, a] = material.getBaseColorFactor();
    const [fr, fg, fb] = change.factor;
    material.setBaseColorFactor([r * fr, g * fg, b * fb, a]);
  }
}

/** A rig joint by name, preferring skin joints over other nodes that happen to share it. */
function findJoint(document: Document, name: string): Node | undefined {
  const joints = document
    .getRoot()
    .listSkins()
    .flatMap((skin) => skin.listJoints());
  return (
    joints.find((joint) => joint.getName() === name) ??
    document
      .getRoot()
      .listNodes()
      .find((node) => node.getName() === name)
  );
}

function attach(document: Document, prop: Document, joint: Node): void {
  const sceneBefore = new Set(document.getRoot().listScenes());
  const map = mergeDocuments(document, prop);
  for (const scene of prop.getRoot().listScenes()) {
    const merged = map.get(scene) as typeof scene;
    for (const child of merged.listChildren()) joint.addChild(child);
    if (!sceneBefore.has(merged)) merged.dispose();
  }
}

export const command: GmCommand = {
  name: 'assets variant',
  summary: 'clone a locked model, recolour its materials or attach props to its joints, and register it as t3',
  usage: '<id> --name <slug> [--recolour <material>=#rrggbb...] [--prop <id>@<slot|joint>...] [--game <id>]',
  example:
    'assets variant t1:kaykit-adventurers/knight@1.0 --name red-knight --recolour knight_texture=#c03030 --prop t1:kaykit-adventurers/sword@1.0@handslot.r',
  flags: {
    name: { type: 'string', help: 'variant slug; the file is assets/model/variants/<slug>.glb' },
    recolour: { type: 'string', multiple: true, help: 'multiply a material (or * for all) by an sRGB hex colour' },
    prop: { type: 'string', multiple: true, help: 'locked model to attach at a card attach slot or rig joint' },
    game: { type: 'string', help: 'game id when .gm/game.json does not exist' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 1) throw new UsageError('variant needs exactly one source id', USAGE);
    const name = flags.name;
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new UsageError('--name must be a lowercase slug', USAGE);
    }
    const recolours = repeated(flags.recolour).map(parseRecolour);
    const props = repeated(flags.prop).map(parseProp);
    if (recolours.length === 0 && props.length === 0) {
      throw new UsageError('a variant needs at least one --recolour or --prop', USAGE);
    }

    const lock = await readLock(ctx.cwd);
    if (lock === null) throw new UsageError('no assets.lock.json here', `gm assets use ${args[0]}`);
    const path = `assets/model/variants/${name}.glb`;
    if (lock.assets.some((entry) => entry.path === path)) {
      throw new UsageError(`${path} is already registered; variants are never overwritten`, `pick another --name`);
    }

    const sourceEntry = lockedGlb(lock, args[0]!);
    const propEntries = props.map((prop) => lockedGlb(lock, prop.id));
    const index = await loadIndex(requireAssetsRoot(ctx));
    const where: Locations = {
      cwd: ctx.cwd,
      assetsRoot: ctx.assetsRoot,
      blobRoot: ctx.blobRoot,
      collections: index.collections,
    };
    /* Provenance (rights, licence, credit) comes from library cards; refuse before cloning, not after. */
    for (const entry of [sourceEntry, ...propEntries]) {
      if (!index.cards.some((card) => card.id === entry.id)) {
        throw new UsageError(
          `${entry.id} is not a library asset; variants are made from library models`,
          'gm assets search --kind model',
        );
      }
    }
    const slots = index.cards.find((card) => card.id === sourceEntry.id)?.rig?.attach_points ?? [];

    await readyMeshopt();
    /* The source is read into memory and only a new file is written: originals are never touched. */
    const document = await readLocked(sourceEntry, where);
    for (const change of recolours) recolour(document, change);
    for (const [i, prop] of props.entries()) {
      const jointName = slots.find((slot) => slot.slot === prop.at)?.joint ?? prop.at;
      const joint = findJoint(document, jointName);
      if (!joint) {
        const known = [
          ...slots.map((slot) => slot.slot),
          ...document
            .getRoot()
            .listSkins()
            .flatMap((skin) => skin.listJoints().map((j) => j.getName())),
        ];
        throw new UsageError(
          `${sourceEntry.id} has no slot or joint ${prop.at}`,
          `one of: ${[...new Set(known)].join(', ') || '(none)'}`,
        );
      }
      attach(document, await readLocked(propEntries[i]!, where), joint);
    }

    /* A GLB holds one binary buffer; each merged prop brought its own. */
    await document.transform(unpartition());
    const absolute = join(ctx.cwd, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, await gltfIo().writeBinary(document), { flag: 'wx' }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new UsageError(`${path} already exists; variants are never overwritten`, 'pick another --name');
      }
      throw error;
    });
    let id: string;
    try {
      id = await registerFile(ctx, path, [sourceEntry.id, ...propEntries.map((entry) => entry.id)], flags.game);
    } catch (error) {
      await rm(absolute, { force: true });
      throw error;
    }
    ctx.out(id);
    ctx.emit('assets.variant', {
      id,
      from: sourceEntry.id,
      recolour: repeated(flags.recolour),
      props: props.map((prop) => `${prop.id}@${prop.at}`),
    });
    return EXIT.ok;
  },
};
