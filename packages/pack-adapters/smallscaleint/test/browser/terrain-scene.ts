import type { AssetLoader } from '@gm/sdk/assets';
import Phaser from 'phaser';

import { QUARTERS, TerrainMap, renderTerrain, terrainSheet, type TerrainSpec } from '../../src/index.js';

export interface TerrainSceneConfig {
  width: number;
  height: number;
  cells: number[];
  terrains: TerrainSpec[];
  seed: number;
  /** Lock id -> URL; ids without one get a synthetic flat-colour sheet (CI has no pack art). */
  urls: Record<string, string>;
  /** Lock id -> facing file names, for decals. */
  facings?: Record<string, Record<string, string>>;
  /** Draw each cell as its own full tile: the blocky ground before transitions. */
  blocky?: boolean;
  canvas?: boolean;
  view: [number, number];
  zoom?: number;
}

const config = (window as unknown as { terrainConfig: TerrainSceneConfig }).terrainConfig;
const COLOURS = ['#8a5a2b', '#c8b040', '#40a040', '#1c5c24', '#909090', '#d0d0d0'];

/** A sheet in the adapter layout whose pieces are the corner masks cut as hard bilinear corners, one colour. */
function syntheticSheet(colour: string): string {
  const { frameWidth: w, frameHeight: h, columns, rows } = terrainSheet;
  const canvas = document.createElement('canvas');
  canvas.width = w * columns;
  canvas.height = h * rows;
  const context = canvas.getContext('2d')!;
  context.fillStyle = colour;
  const box = { top: [32, 0], right: [64, 16], left: [0, 16], bottom: [32, 32] } as const;
  const opposite = { top: 'bottom', right: 'left', left: 'right', bottom: 'top' } as const;
  for (let row = 0; row < rows; row++) {
    const quarter = QUARTERS[row % 4]!;
    const [sx, sy] = box[opposite[quarter]];
    for (let kind = 1; kind < columns; kind++) {
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const x = sx + px + 0.5;
          const y = sy + py + 0.5;
          const u = (x - 64) / 128 + y / 64;
          const v = -(x - 64) / 128 + y / 64;
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
          const inQuadrant = {
            top: u < 0.5 && v < 0.5,
            right: u >= 0.5 && v < 0.5,
            left: u < 0.5 && v >= 0.5,
            bottom: u >= 0.5 && v >= 0.5,
          }[opposite[quarter]];
          if (!inQuadrant) continue;
          const f =
            (kind & 1 ? (1 - u) * (1 - v) : 0) +
            (kind & 2 ? u * (1 - v) : 0) +
            (kind & 4 ? (1 - u) * v : 0) +
            (kind & 8 ? u * v : 0);
          if (f > 0.5 || kind === 15) context.fillRect(kind * w + px, row * h + py, 1, 1);
        }
      }
    }
  }
  return canvas.toDataURL();
}

class TerrainScene extends Phaser.Scene {
  async create() {
    const urls = { ...config.urls };
    config.terrains.forEach((terrain, layer) => {
      urls[terrain.sheet] ??= syntheticSheet(COLOURS[layer % COLOURS.length]!);
    });
    const loader = {
      resolve: (id: string) => ({
        url: urls[id] ?? `https://missing.test/${id}`,
        meta: config.facings?.[id] ? { sprite: { facings: config.facings[id] } } : undefined,
      }),
    } as unknown as AssetLoader;
    const map = new TerrainMap(config);
    const target = config.blocky ? blocky(map) : map;
    const rendered = await renderTerrain(this, loader, target);
    const camera = this.cameras.main;
    camera.setZoom(config.zoom ?? 1);
    camera.centerOn(
      map.height * 64 + ((map.width - map.height) * 64) / 2,
      64 + ((map.width + map.height) * 32) / 2 - 32,
    );
    Object.assign(window, {
      terrain: {
        paint: (x: number, y: number, terrain: number) => {
          const rect = target.paint([{ x, y }], terrain);
          if (rect) rendered.refresh(rect);
        },
        undo: () => {
          const rect = target.undo();
          if (rect) rendered.refresh(rect);
        },
        renderer: this.game.renderer.type,
      },
    });
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      const terrain = (window as unknown as { terrain: Record<string, unknown> }).terrain;
      terrain.view = { x: camera.worldView.x, y: camera.worldView.y };
      Object.assign(window, { terrainReady: true });
    });
  }
}

/** The ground as it is today: every cell its own terrain's full tile, no transitions. */
function blocky(map: TerrainMap): TerrainMap {
  map.piecesAt = (x, y) =>
    QUARTERS.map((quarter, index) => {
      const layer = map.at(x, y);
      return { key: `${quarter}:${x},${y}`, x, y, layer, quarter, case: 15, variant: 0, frame: index * 16 + 15 };
    });
  return map;
}

new Phaser.Game({
  type: config.canvas ? Phaser.CANVAS : Phaser.WEBGL,
  width: config.view[0],
  height: config.view[1],
  backgroundColor: '#101014',
  pixelArt: true,
  render: { preserveDrawingBuffer: true },
  scene: TerrainScene,
});
