/**
 * Scenario CLI: `pnpm --filter @ogm/gm-verify scenario <two-client|multi-client> --game <gameDir> [--out <dir>]`.
 * `multi-client` also takes `--link clean|bad|@<report.json>`, `--clients 2-4`, `--seed <n>` and `--start <name>` (a
 * start configuration from the game's `qa/starts.json`). Prints the report path and summary; exits 1 unless the
 * verdict is pass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { loadEnv } from '@ogm/config';
import { linkProfileSchema, summaryLines } from '@ogm/gm-verify';

import { runMultiClient, type LinkProfileName } from './multi-client.ts';
import { parseClients, parseSeed, readStart } from './multi-client/run-options.ts';
import { runTwoClient } from './two-client.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    game: { type: 'string' },
    out: { type: 'string' },
    link: { type: 'string' },
    clients: { type: 'string' },
    seed: { type: 'string' },
    start: { type: 'string' },
  },
});
const env = loadEnv('gm', { GM_VERIFY_SOFTWARE_GL: { kind: 'bool', required: false } });
/* pnpm runs package scripts in the package directory; paths resolve against where it was invoked. */
// eslint-disable-next-line no-restricted-properties -- INIT_CWD is pnpm's invocation directory, not configuration
const cwd = process.env.INIT_CWD ?? process.cwd();
const command = positionals[0];
const out = (fallback: string) => resolve(cwd, values.out ?? fallback);
const softwareGl = env.GM_VERIFY_SOFTWARE_GL === true;
const log = (line: string) => console.log(`step ${line}`);

/** A profile from the two names, or the `link` object a past run's report carries, so a failure replays from its seed. */
function linkProfile(
  value: string | undefined,
): LinkProfileName | ReturnType<typeof linkProfileSchema.parse> | undefined {
  if (value === undefined) return undefined;
  if (!value.startsWith('@')) return value as LinkProfileName;
  const report = JSON.parse(readFileSync(resolve(cwd, value.slice(1)), 'utf8')) as { link?: unknown };
  if (report.link === undefined) {
    console.error(`${value} carries no link profile; pass clean, bad, or a multi-client report`);
    process.exit(2);
  }
  return linkProfileSchema.parse(report.link);
}

if (!values.game || (command !== 'two-client' && command !== 'multi-client')) {
  console.error(
    'usage: scenario <two-client|multi-client> --game <gameDir> [--out <dir>] [--link clean|bad|@<report.json>]' +
      ' [--clients 2-4] [--seed <n>] [--start <name>]',
  );
  process.exit(2);
}
const gameDir = resolve(cwd, values.game);
/** A bad `--clients`, `--seed` or `--start` is a usage error, reported before anything is built. */
function usage<T>(read: () => T): T {
  try {
    return read();
  } catch (caught) {
    console.error(caught instanceof Error ? caught.message : String(caught));
    process.exit(2);
  }
}
const clients = usage(() => parseClients(values.clients));
const seed = usage(() => parseSeed(values.seed));
const start =
  values.start === undefined
    ? undefined
    : { name: values.start, config: usage(() => readStart(gameDir, values.start!)) };

const { report, reportPath } =
  command === 'two-client'
    ? await runTwoClient({ gameDir, out: out('shots/two-client'), softwareGl, log })
    : await runMultiClient({
        gameDir,
        out: out('shots/multi-client'),
        softwareGl,
        link: linkProfile(values.link),
        clients,
        ...(seed === undefined ? {} : { seed }),
        ...(start === undefined ? {} : { start }),
        log,
      });
for (const line of summaryLines(report)) console.log(line);
console.log(`report ${reportPath}`);
process.exitCode = report.verdict === 'pass' ? 0 : 1;
