import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { workspaceRoot } from '../../outbox.js';
import { locateSkillPack } from '../../skills/pack.js';

const exec = promisify(execFile);
const prompt = `The first two images are the source target and candidate. The third image is their comparison sheet: its panels show target, candidate, difference heatmap, and 50% overlay. Judge these four tiers in order: silhouette and shape, light and colour, materials and shine, fine detail. Score each from 0 to 10. A later tier counts only if the previous tier is at least 7. Return a JSON object with exactly these keys: tiers (array of four numbers in order), differences (array of concrete differences describing position, size or colour, worst first). No markdown around JSON.`;

export const command: GmCommand = {
  name: 'look judge',
  summary: 'ask the look broker to judge a comparison sheet',
  usage: '<side-by-side.png> --rubric tiers',
  flags: { rubric: { type: 'string', help: 'use tiers' } },
  async run(ctx, args, flags) {
    if (args.length !== 1 || flags.rubric !== 'tiers')
      throw new UsageError('provide a sheet and --rubric tiers', 'gm help look judge');
    const root = workspaceRoot(ctx.cwd),
      ref = resolve(ctx.cwd, args[0]!);
    const scratch = join(root, '.gm-mock', 'judge');
    await mkdir(scratch, { recursive: true });
    const id = randomUUID();
    const question = join(scratch, `${id}.txt`);
    await writeFile(question, prompt);
    const script = join(locateSkillPack(ctx.cwd, ctx.skillsDir), 'gm-image-mock', 'scripts', 'request-mock.py');
    try {
      const manifest = JSON.parse(await readFile(`${ref}.json`, 'utf8')) as {
        target: string;
        candidate: string;
        sheet: string;
        hashes: string[];
      };
      if (manifest.sheet !== ref || !Array.isArray(manifest.hashes) || manifest.hashes.length !== 3)
        throw new Error('invalid score sheet provenance');
      const paths = [manifest.target, manifest.candidate, ref];
      for (let i = 0; i < paths.length; i++) {
        const hash = createHash('sha256')
          .update(await readFile(paths[i]!))
          .digest('hex');
        if (hash !== manifest.hashes[i]) throw new Error('score sheet or source changed: run gm look score again');
      }
      const result = await exec(
        'python3',
        [
          script,
          '--kind',
          'look',
          ...paths.flatMap((path) => ['--ref', path]),
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
      const counted = tiers.map((n: number, i: number) =>
        i === 0 || tiers.slice(0, i).every((prior: number) => prior >= 7) ? n : null,
      );
      ctx.out(
        JSON.stringify({
          sheet: relative(ctx.cwd, ref),
          rubric: 'tiers',
          tiers: counted,
          verdict: counted.every((n: number | null) => n !== null && n >= 8) ? 'pass' : 'revise',
          differences,
        }),
      );
      return EXIT.ok;
    } catch (error) {
      ctx.err(error instanceof Error ? error.message : String(error));
      return EXIT.failed;
    }
  },
};
