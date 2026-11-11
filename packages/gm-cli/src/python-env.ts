import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GmContext } from './command.js';

export const PACKAGES = [
  'numpy==2.2.6',
  'Pillow==11.2.1',
  'scipy==1.15.3',
  'scikit-image==0.25.2',
  'imageio==2.38.1',
  'lazy-loader==0.6',
  'networkx==3.7',
  'packaging==26.3',
  'tifffile==2026.11.8',
];
export function pythonEnv(ctx: GmContext, value: unknown): string {
  return typeof value === 'string'
    ? resolve(ctx.cwd, value)
    : join(ctx.home ?? homedir(), '.local', 'share', 'ogm', 'image-python-v1');
}
