import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Find a host-installed zombie ground tile without relying on its intake date. */
export function realGroundTile(): string | undefined {
  const root = fileURLToPath(
    new URL('../../../../../assets-local/packs/smallscaleint-2d-hd-zombie-city-tileset/', import.meta.url),
  );
  if (!existsSync(root)) return undefined;
  return readdirSync(root)
    .map((version) => join(root, version, 'extracted', 'Isometric Tiles', 'Ground A1_E.png'))
    .find(existsSync);
}
