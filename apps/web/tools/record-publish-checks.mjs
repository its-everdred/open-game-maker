import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The deploy wrapper passes only record data; credentials remain in api.env or the host environment.
const [recordPath] = process.argv.slice(2);
const record = JSON.parse(await readFile(recordPath, 'utf8'));
record.recordId = randomUUID();
const queue = join(homedir(), '.local/state/ogm/app-publish-checks');
await mkdir(queue, { recursive: true, mode: 0o700 });
const staged = join(queue, `${record.recordId}.tmp`);
await writeFile(staged, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
await rename(staged, join(queue, `${record.recordId}.json`));
let config = {};
try {
  const file = await readFile(join(process.env.OGM_ENV_DIR || join(homedir(), '.config/ogm/env'), 'api.env'), 'utf8');
  config = Object.fromEntries(
    file.split(/\r?\n/).flatMap((line) => {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      return match ? [[match[1], match[2].replace(/^"(.*)"$/, '$1')]] : [];
    }),
  );
} catch {
  /* The environment may supply the two required values. */
}
const token = process.env.OGM_INTERNAL_TOKEN || config.OGM_INTERNAL_TOKEN;
const port = process.env.OGM_API_PORT || config.OGM_API_PORT;
if (!token || !/^\d+$/.test(port || '')) throw new Error('app check record needs the API token and port');
for (const name of (await readdir(queue)).filter((entry) => /^[0-9a-f-]{36}\.json$/.test(entry)).sort()) {
  const path = join(queue, name);
  const body = await readFile(path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (body === null) continue;
  const response = await fetch(`http://127.0.0.1:${port}/internal/operator/app/publish-checks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ogm-internal': token },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`app check record failed (HTTP ${response.status})`);
  await unlink(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
