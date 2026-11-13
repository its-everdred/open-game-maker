import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { DesignDocSchema, gameManifestSchema } from '@ogm/contracts';

import { checkPublishDist } from '../../dist-validation.js';
import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';

/* The publisher (#283) copies dist/ into the games host; the API reads these two files with these schemas. */
const ARTIFACTS = [
  { file: 'manifest.json', schema: gameManifestSchema },
  { file: 'design/design.json', schema: DesignDocSchema },
] as const;

/** One problem line per missing or invalid publish file in a build dir; empty when the dir can be published. */
export function checkBuildDir(dir: string): string[] {
  const problems: string[] = [];
  for (const { file, schema } of ARTIFACTS) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      const cause = error instanceof Error ? error.message.split('\n')[0] : String(error);
      problems.push(`dist/${file} could not be read: ${cause}`);
      continue;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      problems.push(
        `dist/${file} is invalid at /${issue?.path.join('/') ?? ''}: ${issue?.message ?? 'schema mismatch'}`,
      );
    }
  }
  return problems;
}

export const command: GmCommand = {
  name: 'build',
  summary: 'build the game and check dist/ holds a valid manifest and design',
  usage: '[--json]',
  example: 'build',
  flags: {},
  async run(ctx, args) {
    if (args.length > 0) throw new UsageError(`unexpected argument ${args[0]}`, 'gm help build');
    const dist = join(ctx.cwd, 'dist');
    /* A build that stops writing these files must not pass on copies left by an earlier build. */
    for (const file of [...ARTIFACTS.map((artifact) => artifact.file), 'index.html', 'credits.json']) {
      rmSync(join(dist, file), { force: true });
    }
    const result = spawnSync('pnpm', ['build'], {
      cwd: ctx.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw new CommandError(`pnpm build could not start: ${result.error.message}`);
    if (result.status !== 0) {
      const tail = `${result.stdout}${result.stderr}`.trimEnd().split('\n').slice(-20);
      for (const line of tail) ctx.err(line);
      const problem = `pnpm build failed with exit ${result.status ?? result.signal}`;
      if (ctx.json) ctx.out(JSON.stringify({ ok: false, problems: [problem] }));
      else ctx.err(problem);
      return EXIT.failed;
    }

    const problems = [...checkBuildDir(dist), ...checkPublishDist(dist)];
    if (ctx.json) ctx.out(JSON.stringify({ ok: problems.length === 0, problems }));
    else if (problems.length === 0) ctx.out('dist/ ok: manifest.json, design/design.json');
    for (const problem of ctx.json ? [] : problems) ctx.err(problem);
    return problems.length === 0 ? EXIT.ok : EXIT.failed;
  },
};
