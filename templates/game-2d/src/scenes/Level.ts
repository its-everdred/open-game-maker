import type { CameraRig } from '@ogm/contracts';
import { createRig, PhaserEditorCamera, RigSet } from '@gm/sdk/camera';
import { createPaintedScenery } from '@gm/sdk/phaser';
import { sceneryFromDesign } from '@gm/sdk/scenery';
import Phaser from 'phaser';

import { cameraView, game, getGameContext, type TemplateContext } from '../game.js';
import { GROUND_Y, PLAYER_HEIGHT, PLAYER_WIDTH } from '../state.js';

export class Level extends Phaser.Scene {
  private readonly playerViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private cameraRig: CameraRig | undefined;
  private cameraRigs: RigSet | undefined;
  private freeCamera: PhaserEditorCamera | undefined;
  private appliedCamera = '';

  constructor() {
    super('level');
  }

  create(): void {
    const context = getGameContext();
    this.playerViews.clear();
    const levelWidth = context.design.globals['level.width'];
    this.data.set('level.bounds', { x: 0, y: 0, width: levelWidth, height: 480 });

    if (context.sceneryAssets) {
      const loader = context.sceneryAssets;
      const scenery = createPaintedScenery(this, (id) => loader.resolve(id).url);
      context.pickScenery = scenery.pick;
      context.updateScenery = () => {
        if (!context.design.globals['scenery.settings']) return;
        const backdrop = context.design.globals['scenery.backdrop'] as { assetId?: unknown } | undefined;
        const ids = Object.values(context.design.entities)
          .filter((entity) => entity.prefab.startsWith('scenery:'))
          .map((entity) => ({ id: entity.prefab.slice('scenery:'.length) }));
        if (typeof backdrop?.assetId === 'string') ids.push({ id: backdrop.assetId });
        try {
          const data = sceneryFromDesign(context.design, ids);
          void scenery.update(data).catch((error: unknown) => console.error('scenery update failed', error));
        } catch (error) {
          console.error('scenery update failed', error);
        }
      };
      context.updateScenery();
      this.scale.on(Phaser.Scale.Events.RESIZE, scenery.resize);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.scale.off(Phaser.Scale.Events.RESIZE, scenery.resize);
        context.updateScenery = undefined;
        context.pickScenery = undefined;
        scenery.dispose();
      });
    }

    this.add.rectangle(levelWidth / 2, GROUND_Y + 20, levelWidth, 40, 0x303746);
    for (const platform of context.state.platforms) {
      this.add.rectangle(platform.x, platform.y + platform.height / 2, platform.width, platform.height, 0x727c91);
    }

    this.syncViews(context);
    this.cameraRigs?.dispose();
    this.cameraRigs = new RigSet(() =>
      createRig(game.manifest.view, '2d', { phaser: { scene: this, camera: this.cameras.main } }),
    );
    context.view = {
      screenToWorld: (nx, ny) => {
        const point = this.cameras.main.getWorldPoint(nx * this.cameras.main.width, ny * this.cameras.main.height);
        return [point.x, point.y];
      },
      worldToScreen: (point) => this.cameraRig?.worldToScreen(point) ?? null,
    };
    this.freeCamera = new PhaserEditorCamera(this.cameras.main, this.game.canvas);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.freeCamera?.disable());
    this.appliedCamera = '';
    this.applyCamera(context);
  }

  update(_time: number, delta: number): void {
    const context = getGameContext();
    this.syncViews(context);
    this.applyCamera(context);
    this.cameraRigs?.update(delta / 1000, [
      {
        playerIndex: 0,
        tick: context.state.tick,
        source: 'keyboard',
        actions: {},
      },
    ]);
  }

  private applyCamera(context: TemplateContext): void {
    const view = cameraView(context);
    if (!view || view.key === this.appliedCamera || !this.cameraRigs) return;
    if (view.mode === 'free') this.freeCamera?.enable();
    else {
      this.freeCamera?.disable();
      this.cameraRig = this.cameraRigs.attach(0, { position: view.position });
    }
    this.appliedCamera = view.key;
  }

  private syncViews(context: TemplateContext): void {
    for (const [playerIndex, player] of context.state.players) {
      let view = this.playerViews.get(playerIndex);
      if (!view) {
        view = this.add.rectangle(player.pos.x, player.pos.y, PLAYER_WIDTH, PLAYER_HEIGHT, 0x56c7ff);
        view.setOrigin(0.5, 0);
        this.playerViews.set(playerIndex, view);
      }
      view.setPosition(player.pos.x, player.pos.y);
    }

    for (const [playerIndex, view] of this.playerViews) {
      if (context.state.players.has(playerIndex)) continue;
      view.destroy();
      this.playerViews.delete(playerIndex);
    }
  }
}
