import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { LayoutRow } from '@ogm/asset-cards';
import { resolvePython, workerEnvironment } from '../packs/workers.js';

const worker = fileURLToPath(new URL('../../../../scripts/py/maps/search_clip.py', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url));

/** Score only rows whose indexed rights allowed vision metadata. Never download a model. */
export async function clipScores(
  root: string,
  query: string,
  rows: LayoutRow[],
  home?: string,
): Promise<Map<string, number> | null> {
  const eligible = rows.filter((row) => row.source_folder && row.source_file && row.content_hash);
  if (!eligible.length) return new Map();
  const python = await resolvePython(repo);
  if (!existsSync(python) || !existsSync(worker)) return null;
  return new Promise((resolve) => {
    const child = spawn(python, ['-I', worker], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: workerEnvironment({ assetsRoot: root, workers: 1, home }),
    });
    let output = '';
    let failed = false;
    // Semantic ranking is optional: leave time for index loading and text results.
    const timer = setTimeout(() => {
      failed = true;
      child.kill('SIGKILL');
    }, 3_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (output.length > 5_000_000) {
        failed = true;
        child.kill();
      }
    });
    child.on('error', () => {
      failed = true;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) return resolve(null);
      try {
        const parsed: unknown = JSON.parse(output);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return resolve(null);
        const allowed = new Set(eligible.map((row) => row.id));
        const entries = Object.entries(parsed).filter(
          (entry): entry is [string, number] =>
            allowed.has(entry[0]) &&
            typeof entry[1] === 'number' &&
            Number.isFinite(entry[1]) &&
            Math.abs(entry[1]) <= 1,
        );
        resolve(new Map(entries));
      } catch {
        resolve(null);
      }
    });
    child.stdin.on('error', () => {
      failed = true;
    });
    child.stdin.end(
      JSON.stringify({
        root,
        query,
        rows: eligible.map(({ id, source_folder, source_file, content_hash }) => ({
          id,
          source_folder,
          source_file,
          content_hash,
        })),
      }),
    );
  });
}
