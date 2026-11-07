import { EXIT, UsageError, type GmCommand } from '../../command.js';
import { checkOptions, readLedger, type OptionUnderCheck, type OptionViolation } from '../../ledger/index.js';
import { OPTION_ID, pair, provenancePairs, strings } from '../../ledger/provenance.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

export const optionsFlags = {
  option: { type: 'string', multiple: true, help: 'candidate id and label; repeat 2-5 times' },
  provenance: {
    type: 'string',
    multiple: true,
    help: 'option id and its provenance JSON or @file; repeat once per option',
  },
  command: { type: 'string', help: 'the Command (checkpoint id) the options belong to' },
} as const;

/** Read `--option <id>=<label>` pairs and attach any `--provenance <id>=...` to them. */
export function readOptions(flags: Record<string, unknown>, root: string): OptionUnderCheck[] {
  const options = strings(flags, 'option').map((value) => {
    const [id, label] = pair(value, 'option');
    return { id, label } as OptionUnderCheck;
  });
  if (options.length === 0) throw new UsageError('at least one --option is required', 'gm help options check');
  const ids = options.map(({ id }) => id);
  if (new Set(ids).size !== ids.length)
    throw new UsageError('option ids must be unique', 'use a different id for each --option');
  const provenance = provenancePairs(flags, root);
  for (const id of provenance.keys()) {
    if (!ids.includes(id)) throw new UsageError(`provenance names unknown option "${id}"`, 'use an id from --option');
  }
  const command = typeof flags.command === 'string' ? flags.command.trim() : '';
  if (command && !OPTION_ID.test(command) && !/^[A-Za-z0-9_-]{1,128}$/.test(command))
    throw new UsageError(`invalid Command id "${command}"`, 'pass the checkpoint or decision id');
  return options.map((option) => ({
    ...option,
    ...(command ? { command } : {}),
    ...(provenance.has(option.id) ? { provenance: provenance.get(option.id) } : {}),
  }));
}

export function printViolations(violations: OptionViolation[], err: (line: string) => void): void {
  for (const violation of violations) err(`${violation.kind} ${violation.option_id}: ${violation.detail}`);
}

export const command: GmCommand = {
  name: 'options check',
  summary: 'fail an option that repeats a rejection in the game’s feedback ledger',
  usage: '--option <id>=<label> --option <id>=<label> [--provenance <id>=<json|@file>] [--command <id>]',
  example:
    'options check --option a=Chunky --option b=Flat --provenance a=@provenance/a.json --provenance b=@provenance/b.json',
  flags: { ...optionsFlags },
  async run(ctx, _args, flags) {
    const root = workspaceRoot(ctx.cwd);
    const options = readOptions(flags, root);
    const ledger = readLedger(gameDir(ctx.cwd, root));
    const result = checkOptions(options, ledger);
    if (ctx.json) ctx.out(JSON.stringify(result));
    else if (result.ok)
      ctx.out(
        ledger.entries.length === 0
          ? `options ok: ${options.length} options, no ledger rules yet`
          : `options ok: ${options.length} options match the ${ledger.entries.length} ledger rules`,
      );
    else printViolations(result.violations, ctx.err);
    return result.ok ? EXIT.ok : EXIT.failed;
  },
};
