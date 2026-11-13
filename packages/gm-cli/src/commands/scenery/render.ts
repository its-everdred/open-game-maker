import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildPackIndex } from '@ogm/asset-cards';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { readLock } from '../../lock.js';
import { collectionParts, resolveEntry } from '../../resolve.js';
import { readScene } from '../../scenery/files.js';
import { testSoftwareRenderer } from '../../test-renderer.js';

export const command: GmCommand = {
  name: 'scenery render',
  summary: 'render a still of the scenery without a game build',
  usage: '[--out scenery.png]',
  flags: { out: { type: 'string', default: 'scenery.png', help: 'output PNG path' } },
  async run(ctx, args, flags) {
    if (args.length) throw new UsageError('unexpected argument', 'gm scenery render --out scenery.png');
    const { scene } = await readScene(ctx.cwd);
    const lock = await readLock(ctx.cwd);
    if (!lock) throw new CommandError('assets.lock.json is required to render scenery');
    const temp = await mkdtemp(ctx.config.verifyQueue ? join(ctx.cwd, '.gm-scenery-') : join(tmpdir(), 'gm-scenery-'));
    let retain = false;
    try {
      const assets: Record<string, string> = {};
      const ids = [...new Set(scene.items.map((item) => item.assetId))];
      const entries = ids.map((id) => lock.assets.find((item) => item.id === id)!);
      const packs = entries
        .filter((entry) => entry.source === 'library')
        .map((entry) => collectionParts(entry.id).slug);
      const collections =
        ctx.assetsRoot && packs.length ? (await buildPackIndex(ctx.assetsRoot, packs)).collections : undefined;
      for (const [index, id] of ids.entries()) {
        const entry = entries[index]!;
        const source = await resolveEntry(entry, {
          cwd: ctx.cwd,
          assetsRoot: ctx.assetsRoot,
          blobRoot: ctx.blobRoot,
          ...(collections ? { collections } : {}),
        });
        if (!source.ok) throw new CommandError(`${id}: ${source.detail}; ${source.fix}`);
        const dir = join(temp, 'assets', String(index));
        for (const file of source.files) {
          const dest = join(dir, file.path);
          await mkdir(dirname(dest), { recursive: true });
          await cp(file.absolute, dest);
        }
        assets[id] = `./assets/${index}/${entry.path}`;
      }
      const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
      const compiled = join(packageRoot, 'dist/scenery/browser.js');
      const entry =
        import.meta.url.endsWith('.ts') || !existsSync(compiled)
          ? join(packageRoot, 'src/scenery/browser.ts')
          : compiled;
      await build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        outfile: join(temp, 'browser.js'),
      });
      await writeFile(join(temp, 'scene.json'), JSON.stringify({ scene, assets }));
      await writeFile(
        join(temp, 'index.html'),
        `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'"></head><body><script type="module" src="./browser.js"></script></body></html>`,
      );
      const verify = await import('@ogm/gm-verify');
      const output = resolve(ctx.cwd, typeof flags.out === 'string' ? flags.out : 'scenery.png');
      if (ctx.config.verifyQueue) {
        const runId = verify.newRunId();
        const requestDir = verify.submitRequest(ctx.cwd, {
          v: 1,
          runId,
          ...(ctx.config.jobId ? { jobId: ctx.config.jobId } : {}),
          ...(ctx.config.aiurIssue !== undefined ? { aiurIssue: ctx.config.aiurIssue } : {}),
          ...(ctx.config.aiurRunId ? { aiurRunId: ctx.config.aiurRunId } : {}),
          serveDir: relative(ctx.cwd, temp),
          args: { viewport: 'desktop', frame: 'bare', tier: 'desktop', frames: [0] },
        });
        retain = true;
        let report: Awaited<ReturnType<typeof verify.waitForReport>>;
        try {
          report = await verify.waitForReport(requestDir);
        } catch (error) {
          throw new CommandError(
            `scenery capture report unavailable; request retained: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        retain = false;
        const frame = report.frames[0];
        if (report.verdict === 'error' || !frame)
          throw new CommandError(`scenery render failed: ${report.error ?? 'no still produced'}`);
        await mkdir(dirname(output), { recursive: true });
        await cp(join(requestDir, frame.path), output);
        ctx.out(`wrote ${basename(output)}`);
        return EXIT.ok;
      }
      const slot = await verify.acquireSlot({ runtimeDir: ctx.config.runtimeDir });
      try {
        const server = await verify.serveStatic(temp);
        try {
          const browser = await verify.launch(
            testSoftwareRenderer(ctx.config.verifySoftwareGlConfigured ? ctx.config.verifySoftwareGl : undefined),
          );
          try {
            const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
            const origin = new URL(server.url).origin;
            await page.route('**/*', async (route) => {
              if (new URL(route.request().url()).origin === origin) await route.continue();
              else await route.abort();
            });
            await page.goto(server.url);
            await page.waitForFunction(() => window.sceneryReady || window.sceneryError, null, { timeout: 60_000 });
            const error = await page.evaluate(() => window.sceneryError);
            if (error) throw new CommandError(`scenery render failed: ${error}`);
            await mkdir(dirname(output), { recursive: true });
            await page.screenshot({ path: output });
            ctx.out(`wrote ${basename(output)}`);
          } finally {
            await browser.close();
          }
        } finally {
          await server.close();
        }
      } finally {
        slot.release();
      }
    } finally {
      if (!retain) await rm(temp, { recursive: true, force: true });
    }
    return EXIT.ok;
  },
};
