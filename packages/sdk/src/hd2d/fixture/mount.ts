import type { Camera, Scene, WebGLRenderer } from 'three';
import type Phaser from 'phaser';
import type { TestArt } from './testart.js';

export interface MountContext {
  renderer: 'phaser' | 'three';
  phaser?: { scene: Phaser.Scene };
  three?: { renderer: WebGLRenderer; scene: Scene; camera: Camera };
  art: TestArt;
  quality: 'off' | 'low' | 'high';
  seed: number;
}

export interface Mounted {
  update(timeMs: number): void;
  dispose(): void;
}

export type Mount = (ctx: MountContext) => Mounted;
