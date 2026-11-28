import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

async function main() {
  const envDir = process.env.OGM_ENV_DIR ?? join(homedir(), '.config/ogm/env');
  const values: Record<string, string> = {};
  for (const line of readFileSync(join(envDir, 'api.env'), 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    values[line.slice(0, index).trim()] = line
      .slice(index + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }
  if (!values.AIUR_API_URL || !values.AIUR_API_TOKEN || !values.OGM_DATA_DIR) throw new Error('missing config');
  const base = values.AIUR_API_URL.replace(/\/$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname))
    throw new Error('core API must be loopback');
  const marker = `OGM notification QA ${randomUUID()}`;
  const response = await fetch(`${base}/api/v1/operator/notify`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${values.AIUR_API_TOKEN}`,
      'content-type': 'application/json',
      origin: base,
      'x-aiur-request': '1',
    },
    body: JSON.stringify({ kind: 'info', text: marker }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 202) throw new Error('notification post rejected');
  const db = new DatabaseSync(join(values.OGM_DATA_DIR, 'ogm.sqlite3'), { readOnly: true });
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (db.prepare("SELECT 1 FROM notifications WHERE kind = 'executor.notify' AND body = ?").get(marker)) {
        process.stdout.write('executor notification row observed\n');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('notification row not observed within 90 seconds');
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`ogm-qa-executor-notify: ${error instanceof Error ? error.name : 'Error'}\n`);
  process.exitCode = 1;
});
