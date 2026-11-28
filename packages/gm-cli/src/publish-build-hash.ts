import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Hash paths, file contents and links without following links or including timestamps. */
export function publishBuildHash(root: string): string {
  const hash = createHash('sha256');
  const add = (value: string | Buffer) => {
    const bytes = Buffer.from(value);
    hash.update(`${bytes.length}:`).update(bytes);
  };
  const walk = (path: string, relative: string) => {
    const info = lstatSync(path);
    add(relative);
    if (info.isSymbolicLink()) {
      add('link');
      add(readlinkSync(path));
    } else if (info.isDirectory()) {
      add('directory');
      for (const name of readdirSync(path).sort()) walk(join(path, name), relative ? `${relative}/${name}` : name);
    } else if (info.isFile()) {
      add('file');
      add(readFileSync(path));
    } else throw new Error(`unsupported build entry: ${relative}`);
  };
  walk(root, '');
  return hash.digest('hex');
}
