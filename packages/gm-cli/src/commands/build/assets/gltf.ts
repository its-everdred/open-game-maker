import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type Document, NodeIO, type Scene } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

import { assertNoSymlinks, sha256, writeIfChanged } from './files.js';
import type { GltfFacts } from './types.js';

export async function readyMeshopt(): Promise<void> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
}

export function gltfIo(): NodeIO {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

export function triangles(document: Document): number {
  let count = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const vertices = primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0;
      if (primitive.getMode() === 4) count += Math.floor(vertices / 3);
    }
  }
  return count;
}

export async function textureMeasurements(
  document: Document,
): Promise<{ gpuTexMB: number; maxTexture: number; textureKeys: string[] }> {
  let pixels = 0;
  let maxTexture = 0;
  const textureKeys: string[] = [];
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    textureKeys.push(sha256(image));
    const metadata = await sharp(image).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    pixels += width * height;
    maxTexture = Math.max(maxTexture, width, height);
  }
  return {
    gpuTexMB: (pixels * 4 * 1.33) / (1024 * 1024),
    maxTexture,
    textureKeys: textureKeys.sort(),
  };
}

function validFacts(value: unknown): value is GltfFacts {
  if (value === null || typeof value !== 'object') return false;
  const facts = value as Partial<GltfFacts>;
  return (
    typeof facts.triangles === 'number' &&
    typeof facts.rigged === 'boolean' &&
    typeof facts.animated === 'boolean' &&
    Array.isArray(facts.textureKeys) &&
    facts.textureKeys.every((key) => typeof key === 'string')
  );
}

export async function inspectGltf(
  path: string,
  cwd: string,
  useCache: boolean,
): Promise<{ facts: GltfFacts; sourceHash: string }> {
  const bytes = await readFile(path);
  const sourceHash = sha256(bytes);
  const recipeHash = sha256('gltf-facts-v2|gltf-transform-4.5.1|meshoptimizer-1.3.0|sharp-0.35.5');
  const cachePath = join(cwd, '.gm/cache/assets/facts', `${sourceHash}-${recipeHash}.json`);
  if (useCache) {
    try {
      await assertNoSymlinks(cwd, cachePath);
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as unknown;
      if (validFacts(cached)) return { facts: cached, sourceHash };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
  }
  await readyMeshopt();
  const document = await gltfIo().readBinary(bytes);
  const facts = {
    triangles: triangles(document),
    rigged: document.getRoot().listSkins().length > 0,
    animated: document
      .getRoot()
      .listAnimations()
      .some((animation) => animation.listChannels().some((channel) => channel.getTargetNode() !== null)),
    textureKeys: (await textureMeasurements(document)).textureKeys,
  };
  if (useCache) await writeIfChanged(cachePath, `${JSON.stringify(facts, null, 2)}\n`, cwd);
  return { facts, sourceHash };
}

export function sceneBounds(scene: Scene): [number, number, number] {
  const bounds = getBounds(scene);
  return [bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2], bounds.max[1] - bounds.min[1]];
}

export function setAssetLicense(document: Document, license: unknown): void {
  const asset = document.getRoot().getAsset() as Record<string, unknown>;
  asset.extras = { ...((asset.extras as Record<string, unknown> | undefined) ?? {}), license };
}
