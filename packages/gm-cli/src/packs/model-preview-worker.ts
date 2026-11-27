import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromiumGuard } from './chromium-guard.js';

const [source, out, assetsRoot, software, expectedHash, cached, runtimeRoot] = process.argv.slice(2);
if (!source || !out || !assetsRoot || !expectedHash || !runtimeRoot)
  throw new Error('missing preview worker arguments');
const hash = createHash('sha256');
for await (const chunk of createReadStream(source)) hash.update(chunk as Buffer);
if (hash.digest('hex') !== expectedHash) {
  process.stderr.write('source hash does not match card');
  process.exitCode = 3;
} else if (cached === 'true') {
  process.stdout.write(JSON.stringify({ renderer: 'cached' }));
} else {
  const { renderSheet } = await import('@ogm/asset-previews');
  const runtime = await mkdtemp(join(runtimeRoot, 'ogm-preview-guard-'));
  try {
    let executablePath = '/usr/bin/chromium';
    if (process.platform === 'linux') {
      executablePath = join(runtime, 'chromium-guard');
      // PR_SET_PDEATHSIG survives exec. The parent check closes the startup race.
      await writeFile(executablePath, chromiumGuard(process.pid), { mode: 0o700 });
    }
    const result = await renderSheet(source, out, {
      assetsRoot,
      executablePath,
      runtimeRoot,
      software: software === 'true',
    });
    process.stdout.write(JSON.stringify({ renderer: result.renderer }));
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
}
