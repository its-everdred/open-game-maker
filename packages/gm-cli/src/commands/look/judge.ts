import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { workspaceRoot } from '../../outbox.js';
import { catalogRoot } from '../../skills/catalog.js';
import { image, resize, sheet, type Rect } from '../../look/score.js';
import sharp from 'sharp';

const exec = promisify(execFile);
const prompt = `The first two images are source references for policy checks only. Judge only the first two panels of the third image, the comparison sheet; its remaining panels show a difference heatmap and 50% overlay. Judge these four tiers in order: silhouette and shape, light and colour, materials and shine, fine detail. Score each from 0 to 10. A later tier counts only if the previous tier is at least 7. Return a JSON object with exactly these keys: tiers (array of four numbers in order), differences (array of concrete differences describing position, size or colour, worst first). No markdown around JSON.`;

export const judgeCacheKey = (hashes: string[], runs = 3) =>
  createHash('sha256')
    .update(JSON.stringify([hashes, 'tiers', runs, prompt]))
    .digest('hex');

export const command: GmCommand = {
  name: 'look judge',
  summary: 'ask the look broker to judge a comparison sheet',
  usage: '<side-by-side.png> --rubric tiers [--runs N]',
  flags: {
    rubric: { type: 'string', help: 'use tiers' },
    runs: { type: 'string', help: 'number of judgments (default 3)' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 1 || flags.rubric !== 'tiers')
      throw new UsageError('provide a sheet and --rubric tiers', 'gm help look judge');
    const runs = flags.runs === undefined ? 3 : Number(flags.runs);
    if (!Number.isInteger(runs) || runs < 1 || runs > 20)
      throw new UsageError('runs must be an integer from 1 to 20', 'gm help look judge');
    const root = workspaceRoot(ctx.cwd),
      ref = resolve(ctx.cwd, args[0]!);
    const scratch = join(root, '.gm-mock', 'judge');
    await mkdir(scratch, { recursive: true });
    const id = randomUUID();
    const question = join(scratch, `${id}.txt`);
    await writeFile(question, prompt);
    const script = join(catalogRoot(root, ctx.skillsDir), 'gm-image-mock', 'scripts', 'request-mock.py');
    const snapshot = join(scratch, `${id}.png`);
    try {
      const manifest = JSON.parse(await readFile(`${ref}.json`, 'utf8')) as {
        target: string;
        candidate: string;
        sheet: string;
        hashes: string[];
        crop: Rect | null;
      };
      if (manifest.sheet !== ref || !Array.isArray(manifest.hashes) || manifest.hashes.length !== 3)
        throw new Error('invalid score sheet provenance');
      const paths = [manifest.target, manifest.candidate, ref];
      const bytes = await Promise.all(paths.map((path) => readFile(path)));
      for (let i = 0; i < paths.length; i++) {
        const hash = createHash('sha256').update(bytes[i]!).digest('hex');
        if (hash !== manifest.hashes[i]) throw new Error('score sheet or source changed: run gm look score again');
      }
      const target = await image(bytes[0]!, manifest.crop ?? undefined);
      const dimensions = await sharp(bytes[0]!).metadata();
      if (!dimensions.width || !dimensions.height) throw new Error('target dimensions unavailable');
      const candidate = await resize(bytes[1]!, dimensions.width, dimensions.height, manifest.crop ?? undefined);
      if (!(await sheet(target, candidate)).equals(bytes[2]!)) throw new Error('sheet does not match its sources');
      await writeFile(snapshot, bytes[2]!, { flag: 'wx', mode: 0o600 });
      const cacheKey = judgeCacheKey(manifest.hashes, runs);
      const cache = join(scratch, `verdict-${cacheKey}.json`);
      let verdict: { tiers: (number | null)[]; spread: (number | null)[]; verdict: string; differences: string[] };
      const cached = await readFile(cache, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (cached !== null) verdict = JSON.parse(cached) as typeof verdict;
      else {
        const samples: number[][] = [];
        let lastDifferences: string[] = [];
        for (let run = 0; run < runs; run++) {
          const result = await exec(
            'python3',
            [
              script,
              '--kind',
              'look',
              '--no-look-log',
              ...[paths[0]!, paths[1]!, snapshot].flatMap((path) => ['--ref', path]),
              '--prompt-file',
              question,
              '--out',
              scratch,
            ],
            { cwd: root, timeout: 620_000 },
          );
          const answer = await readFile(resolve(root, result.stdout.trim()), 'utf8');
          const json = answer.match(/\{[\s\S]*\}/)?.[0];
          if (!json) throw new Error('look broker returned no JSON');
          const data: unknown = JSON.parse(json);
          if (!data || typeof data !== 'object') throw new Error('invalid judge response');
          const { tiers, differences } = data as { tiers?: unknown; differences?: unknown };
          if (
            !Array.isArray(tiers) ||
            tiers.length !== 4 ||
            tiers.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10) ||
            !Array.isArray(differences) ||
            differences.some((s) => typeof s !== 'string')
          )
            throw new Error('invalid judge tiers or differences');
          samples.push(tiers as number[]);
          lastDifferences = differences as string[];
        }
        const median = (values: number[]) => {
          const sorted = values.sort((a, b) => a - b);
          const middle = Math.floor(sorted.length / 2);
          return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
        };
        const medians = Array.from({ length: 4 }, (_, i) => median(samples.map((row) => row[i]!)));
        const counted = medians.map((n, i) => (i === 0 || medians.slice(0, i).every((prior) => prior >= 7) ? n : null));
        const spread = counted.map((n, i) =>
          n === null ? null : Math.max(...samples.map((row) => Math.abs(row[i]! - n))),
        );
        verdict = {
          tiers: counted,
          spread,
          verdict: counted.every((n) => n !== null && n >= 8) ? 'pass' : 'revise',
          differences: lastDifferences,
        };
        const temporaryCache = join(scratch, `${id}.verdict.json`);
        try {
          await writeFile(temporaryCache, JSON.stringify(verdict), { flag: 'wx', mode: 0o600 });
          try {
            await link(temporaryCache, cache);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            verdict = JSON.parse(await readFile(cache, 'utf8')) as typeof verdict;
          }
        } finally {
          await rm(temporaryCache, { force: true });
        }
      }
      ctx.out(JSON.stringify({ sheet: relative(ctx.cwd, ref), rubric: 'tiers', ...verdict }));
      return EXIT.ok;
    } catch (error) {
      ctx.err(error instanceof Error ? error.message : String(error));
      return EXIT.failed;
    } finally {
      await rm(snapshot, { force: true });
    }
  },
};
