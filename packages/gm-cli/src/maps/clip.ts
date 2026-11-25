import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { LayoutRow } from '@ogm/asset-cards';

const worker = fileURLToPath(new URL('../../../../scripts/py/maps/search_clip.py', import.meta.url));
const python = fileURLToPath(new URL('../../../../scripts/py/audio/.venv/bin/python', import.meta.url));

/** Score only rows whose indexed rights allowed vision metadata. Never download a model. */
export async function clipScores(
  root: string,
  query: string,
  rows: LayoutRow[],
  env?: Record<string, string | undefined>,
): Promise<Map<string, number> | null> {
  const eligible = rows.filter((row) => row.thumbnail && row.source_folder && row.source_file && row.content_hash);
  if (!eligible.length) return new Map();
  if (!existsSync(python) || !existsSync(worker)) return null;
  return new Promise((resolve) => {
    const child = spawn(python, ['-I', worker], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
    });
    let output = '';
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
    }, 120_000);
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
