import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { KHRTextureTransform, type Transform } from '@gltf-transform/extensions';
import { expect, it } from 'vitest';
import sharp from 'sharp';
import { exportUnityAssembly } from '../src/packs/unity/export.js';
import type { PlannedUnityMesh } from '../src/packs/unity/plan.js';

const probe = spawnSync(
  'blender',
  [
    '--background',
    '--factory-startup',
    '--python-use-system-env',
    '--python-exit-code',
    '1',
    '--python-expr',
    'import numpy',
  ],
  { encoding: 'utf8', timeout: 180_000 },
);
const unavailable =
  (probe.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ||
  /No module named ['"]numpy['"]/.test(probe.stderr ?? '');
if (probe.status !== 0 && !unavailable)
  throw new Error(`Blender probe failed: ${probe.error?.message ?? probe.stderr}`);
const available = probe.status === 0;

it.skipIf(!available)(
  'exports a transformed FBX and refuses to replace an existing GLB (requires Blender and NumPy)',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'gm-unity-export-'));
    try {
      const fbx = join(root, 'roof.fbx');
      const texture = join(root, 'color.png');
      const mask = join(root, 'mask.png');
      const rgbMask = join(root, 'rgb-mask.png');
      await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 120, g: 160, b: 200, alpha: 1 } } })
        .png()
        .toFile(texture);
      await sharp(Buffer.from([64, 64, 64, 255, 192, 192, 192, 255, 64, 64, 64, 255, 192, 192, 192, 255]), {
        raw: { width: 2, height: 2, channels: 4 },
      })
        .png()
        .toFile(mask);
      await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } } })
        .png()
        .toFile(rgbMask);
      const create = `import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.mesh.primitive_cube_add()\nbpy.context.object.name='Roof'\nbpy.context.object.data.name='RoofGeometry'\nbpy.context.object.data.uv_layers.new(name='Secondary')\nbpy.context.object.data.uv_layers.new(name='Tertiary')\nbpy.context.object.data.materials.append(bpy.data.materials.new('Base'))\nbpy.ops.export_scene.fbx(filepath=${JSON.stringify(fbx)})`;
      const result = spawnSync(
        'blender',
        [
          '--background',
          '--factory-startup',
          '--python-use-system-env',
          '--python-exit-code',
          '1',
          '--python-expr',
          create,
        ],
        { encoding: 'utf8', timeout: 180_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      const plan: PlannedUnityMesh[] = [
        {
          name: 'Roof',
          transformId: 'root/2',
          parentId: null,
          position: [1, 2, 3],
          rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
          scale: [1, 1, 1],
          active: true,
          rendererActive: true,
          materials: [],
          model: { path: fbx, name: 'Roof' },
          surfaces: [
            {
              path: 'fixture.mat',
              textures: [{ guid: 'test', scale: [2, 3], offset: [0.25, 0.125], uv: 2 }],
              texturePaths: [texture],
              textureSrgb: [true],
              color: [0.5, 1, 0.25, 1],
              blends: [
                {
                  a: { path: 'fixture.mat', textures: [], texturePaths: [], textureSrgb: [], color: [0.5, 1, 1, 1] },
                  b: {
                    path: 'fixture.mat',
                    textures: [{ guid: 'mask', scale: [2, 3], offset: [0.25, 0.125], uv: 2 }],
                    texturePaths: [mask],
                    textureSrgb: [false],
                    color: [1, 1, 1, 1],
                  },
                  weight: {
                    op: 'clamp',
                    args: [
                      {
                        op: 'add',
                        args: [
                          {
                            op: 'multiply',
                            args: [
                              {
                                term: {
                                  path: 'fixture.mat',
                                  textures: [{ guid: 'mask', scale: [2, 3], offset: [0.25, 0.125], uv: 2 }],
                                  texturePaths: [mask],
                                  textureSrgb: [false],
                                  color: [1, 1, 1, 1],
                                },
                                channel: 0,
                              },
                              0.5,
                            ],
                          },
                          0.1,
                        ],
                      },
                      0,
                      1,
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'Roof child',
          transformId: 'root/3',
          parentId: 'root/2',
          position: [1, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          active: true,
          rendererActive: true,
          materials: [],
          model: { path: fbx, name: 'Roof' },
          surfaces: [
            {
              path: 'fixture.mat',
              textures: [{ guid: 'test', scale: [2, 3], offset: [0.25, 0.125], uv: 2 }],
              texturePaths: [texture],
              textureSrgb: [true],
              color: [0.5, 1, 0.25, 1],
              blends: [
                {
                  a: { path: 'fixture.mat', textures: [], texturePaths: [], textureSrgb: [], color: [0.5, 1, 1, 1] },
                  b: {
                    path: 'fixture.mat',
                    textures: [{ guid: 'mask', scale: [2, 3], offset: [0.25, 0.125], uv: 2 }],
                    texturePaths: [mask],
                    textureSrgb: [false],
                    color: [1, 1, 1, 1],
                  },
                  weight: {
                    op: 'clamp',
                    args: [
                      {
                        op: 'add',
                        args: [
                          {
                            op: 'multiply',
                            args: [
                              {
                                term: {
                                  path: 'fixture.mat',
                                  textures: [{ guid: 'mask', scale: [2, 3], offset: [0.25, 0.125], uv: 2 }],
                                  texturePaths: [mask],
                                  textureSrgb: [false],
                                  color: [1, 1, 1, 1],
                                },
                                channel: 0,
                              },
                              0.5,
                            ],
                          },
                          0.1,
                        ],
                      },
                      0,
                      1,
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'Plain',
          transformId: 'root/4',
          parentId: 'root/2',
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          active: true,
          rendererActive: true,
          materials: [],
          model: { path: fbx, name: 'Roof' },
          surfaces: [
            {
              path: 'plain.mat',
              textures: [],
              texturePaths: [],
              textureSrgb: [],
              color: [1, 1, 1, 1],
              blends: [
                {
                  a: { path: 'plain.mat', textures: [], texturePaths: [], textureSrgb: [], color: [0.5, 0, 0, 1] },
                  b: { path: 'plain.mat', textures: [], texturePaths: [], textureSrgb: [], color: [1, 1, 1, 1] },
                  weight: {
                    op: 'add',
                    args: [
                      {
                        op: 'contrast',
                        args: [
                          {
                            op: 'clamp',
                            args: [
                              {
                                op: 'add',
                                args: [
                                  { op: 'subtract', args: [1, 0.75] },
                                  { op: 'multiply', args: [0.125, 2] },
                                ],
                              },
                              0,
                              1,
                            ],
                          },
                          1,
                        ],
                      },
                      { op: 'subtract', args: [{ op: 'invert', args: [{ op: 'divide', args: [1, 2] }] }, 0.5] },
                    ],
                  },
                },
              ],
            },
          ],
        },
        {
          name: 'Default UV',
          transformId: 'root/5',
          parentId: 'root/2',
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          active: true,
          rendererActive: true,
          materials: [],
          model: { path: fbx, name: 'Roof' },
          surfaces: [
            {
              path: 'default-uv.mat',
              textures: [{ guid: 'test', scale: [1, 1], offset: [0, 0] }],
              texturePaths: [texture],
              textureSrgb: [true],
              color: [1, 1, 1, 1],
            },
          ],
        },
      ];
      const output = join(root, 'assembly.glb');
      await exportUnityAssembly(plan, output);
      const bytes = await readFile(output);
      const document = await new NodeIO().registerExtensions([KHRTextureTransform]).readBinary(bytes);
      const parent = document
        .getRoot()
        .listNodes()
        .find((node) => node.getName() === 'Roof');
      expect(parent).toBeDefined();
      const child = document
        .getRoot()
        .listNodes()
        .find((node) => node.getName() === 'Roof child');
      expect(child).toBeDefined();
      const parentWorld = parent!.getWorldMatrix();
      const childWorld = child!.getWorldMatrix();
      expect(childWorld[12] - parentWorld[12]).toBeCloseTo(0, 5);
      expect(childWorld[13] - parentWorld[13]).toBeCloseTo(0, 5);
      expect(childWorld[14] - parentWorld[14]).toBeCloseTo(-1, 5);
      expect(document.getRoot().listMeshes()).toHaveLength(4);
      const bounds = getBounds(document.getRoot().listScenes()[0]!);
      expect(bounds.min[1]).toBeCloseTo(0, 5);
      expect(bounds.min[0] + bounds.max[0]).toBeCloseTo(0, 5);
      expect(bounds.min[2] + bounds.max[2]).toBeCloseTo(0, 5);
      const material = document
        .getRoot()
        .listMaterials()
        .find((entry) => entry.getBaseColorTextureInfo()?.getTexCoord() === 2);
      expect(material).toBeDefined();
      expect(material!.getBaseColorTexture()).not.toBeNull();
      expect(material!.getBaseColorTextureInfo()?.getTexCoord()).toBe(2);
      expect(
        document
          .getRoot()
          .listMaterials()
          .some((entry) => entry.getBaseColorTexture() && entry.getBaseColorTextureInfo()?.getTexCoord() === 0),
      ).toBe(true);
      const plain = document
        .getRoot()
        .listMaterials()
        .find((entry) => !entry.getBaseColorTexture())!;
      expect(plain.getBaseColorFactor()).toEqual([0.75, 0.5, 0.5, 1]);
      const textureTransform = material!.getBaseColorTextureInfo()?.getExtension<Transform>('KHR_texture_transform');
      expect(textureTransform?.getScale()).toEqual([2, 3]);
      expect(textureTransform?.getOffset()[0]).toBeCloseTo(0.25, 5);
      const pixels = await sharp(material!.getBaseColorTexture()!.getImage()!).ensureAlpha().raw().toBuffer();
      expect(pixels[0]).toBeGreaterThan(54);
      expect(pixels[0]).toBeLessThan(61);
      expect(pixels[1]).toBeGreaterThan(143);
      expect(pixels[1]).toBeLessThan(151);
      expect(pixels[2]).toBeGreaterThan(93);
      expect(pixels[2]).toBeLessThan(102);
      expect(pixels[4]).toBeGreaterThan(64);
      expect(pixels[4]).toBeLessThan(73);
      const mixed = structuredClone(plan);
      mixed[0]!.surfaces[0]!.blends![0]!.b.textures[0]!.uv = 0;
      mixed[1]!.surfaces[0]!.blends![0]!.b.textures[0]!.uv = 0;
      const mixedOutput = join(root, 'mixed.glb');
      await exportUnityAssembly(mixed, mixedOutput);
      const mixedDocument = await new NodeIO()
        .registerExtensions([KHRTextureTransform])
        .readBinary(await readFile(mixedOutput));
      const bakedMaterial = mixedDocument
        .getRoot()
        .listMaterials()
        .find((entry) => entry.getBaseColorTexture()?.getSize()?.[0] === 256);
      expect(bakedMaterial?.getBaseColorTexture()).toBeTruthy();
      expect(bakedMaterial?.getBaseColorTextureInfo()?.getTexCoord()).toBe(0);
      const bakedPrimitives = mixedDocument
        .getRoot()
        .listMeshes()
        .flatMap((mesh) => mesh.listPrimitives())
        .filter((primitive) => primitive.getMaterial() === bakedMaterial);
      expect(bakedPrimitives).toHaveLength(2);
      expect(bakedPrimitives.every((primitive) => primitive.getAttribute('TEXCOORD_0'))).toBe(true);
      const rgbPlan = [structuredClone(plan[3]!)];
      rgbPlan[0]!.parentId = null;
      rgbPlan[0]!.surfaces[0] = {
        path: 'rgb.mat',
        textures: [],
        texturePaths: [],
        textureSrgb: [],
        color: [1, 1, 1, 1],
        blends: [
          {
            a: { path: 'rgb.mat', textures: [], texturePaths: [], textureSrgb: [], color: [0, 0, 0, 1] },
            b: { path: 'rgb.mat', textures: [], texturePaths: [], textureSrgb: [], color: [1, 1, 1, 1] },
            weight: {
              term: {
                path: 'rgb.mat',
                textures: [{ guid: 'rgb', scale: [1, 1], offset: [0, 0] }],
                texturePaths: [rgbMask],
                textureSrgb: [false],
                color: [1, 1, 1, 1],
              },
              channel: 'rgb',
            },
          },
        ],
      };
      const rgbOutput = join(root, 'rgb.glb');
      await exportUnityAssembly(rgbPlan, rgbOutput);
      const rgbDocument = await new NodeIO()
        .registerExtensions([KHRTextureTransform])
        .readBinary(await readFile(rgbOutput));
      const rgbImage = rgbDocument.getRoot().listMaterials()[0]!.getBaseColorTexture()!.getImage()!;
      const rgbPixels = await sharp(rgbImage).ensureAlpha().raw().toBuffer();
      expect(rgbPixels[0]).toBeLessThan(3);
      expect(rgbPixels[1]).toBeGreaterThan(185);
      expect(rgbPixels[1]).toBeLessThan(191);
      expect(rgbPixels[2]).toBeGreaterThan(252);
      const adjustedPlan = [structuredClone(plan[3]!)];
      adjustedPlan[0]!.parentId = null;
      adjustedPlan[0]!.surfaces[0] = {
        path: 'adjusted.mat',
        textures: [],
        texturePaths: [],
        textureSrgb: [],
        color: [1.1, 1.1, 1.1, 1],
        products: [
          {
            path: 'adjusted.mat',
            textures: [{ guid: 'rgb', scale: [1, 1], offset: [0, 0] }],
            texturePaths: [rgbMask],
            textureSrgb: [false],
            color: [1, 1, 1, 1],
            adjustment: { op: 'saturation', amount: 0.5 },
          },
        ],
        adjustment: { op: 'power', amount: 2 },
      };
      const adjustedOutput = join(root, 'adjusted.glb');
      await exportUnityAssembly(adjustedPlan, adjustedOutput);
      const adjustedDocument = await new NodeIO()
        .registerExtensions([KHRTextureTransform])
        .readBinary(await readFile(adjustedOutput));
      const adjustedPixels = await sharp(
        adjustedDocument.getRoot().listMaterials()[0]!.getBaseColorTexture()!.getImage()!,
      )
        .ensureAlpha()
        .raw()
        .toBuffer();
      const components = [0, 128 / 255, 1];
      const luma = components[0]! * 0.2126729 + components[1]! * 0.7151522 + components[2]! * 0.072175;
      for (let index = 0; index < 3; index++) {
        const linear = Math.min(1, (1.1 * (luma + 0.5 * (components[index]! - luma))) ** 2);
        const encoded = 255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);
        expect(Math.abs(adjustedPixels[index]! - encoded)).toBeLessThan(3);
      }
      const missing = [structuredClone(plan[3]!)];
      missing[0]!.parentId = null;
      missing[0]!.surfaces[0]!.textures[0]!.uv = 7;
      await expect(exportUnityAssembly(missing, join(root, 'missing.glb'))).rejects.toThrow(
        'missing or unsupported Unity UV channel',
      );
      await expect(exportUnityAssembly(plan, output)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(output)).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  600_000,
);
