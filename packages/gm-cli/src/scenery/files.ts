import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseScenery, type Scenery } from '@ogm/contracts';
import { CommandError } from '../command.js';
import { readLock, writeGeneratedText } from '../lock.js';

export async function readScene(cwd: string): Promise<{ scene: Scenery; assets: { id: string }[] }> {
  const lock = await readLock(cwd);
  if (!lock) throw new CommandError('assets.lock.json is required to edit scenery');
  const path = join(cwd, 'scenery.json');
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new CommandError(`cannot read scenery.json: ${error instanceof Error ? error.message : String(error)}`);
    }
    data = {
      version: 1,
      items: [],
      terrain: [],
      lighting: 'warm-forest',
      camera: { position: [8, 8, 8], target: [0, 0, 0], zoom: 1 },
    };
  }
  try {
    return { scene: parseScenery(data, lock.assets), assets: lock.assets };
  } catch (error) {
    throw new CommandError(`invalid scenery: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeScene(cwd: string, scene: Scenery, assets: { id: string }[]): Promise<void> {
  let validated: Scenery;
  try {
    validated = parseScenery(scene, assets);
  } catch (error) {
    throw new CommandError(`invalid scenery: ${error instanceof Error ? error.message : String(error)}`);
  }
  await writeGeneratedText(join(cwd, 'scenery.json'), `${JSON.stringify(validated, null, 2)}\n`);
}

export function point(value: unknown): [number, number, number] {
  const parts = typeof value === 'string' ? value.split(',').map(Number) : [];
  if (
    parts.length !== 3 ||
    parts.some((v) => !Number.isFinite(v)) ||
    (value as string).split(',').some((v) => !v.trim())
  ) {
    throw new CommandError('position must be three comma-separated numbers');
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}
