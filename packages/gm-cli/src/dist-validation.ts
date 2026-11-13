import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Checks the files and asset paths required by the games host. */
export function checkPublishDist(dir: string): string[] {
  const required = ['index.html', 'manifest.json', 'design/design.json', 'credits.json'];
  const missing = required.filter((file) => !existsSync(join(dir, file)));
  if (missing.length) return [`the build wrote no ${missing.map((file) => `dist/${file}`).join(', ')}`];
  if (readFileSync(join(dir, 'index.html'), 'utf8').includes('="/assets/')) {
    return ['dist/index.html loads assets from the origin root; set a relative base'];
  }
  return [];
}
