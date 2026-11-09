import { EXIT, UsageError, type GmCommand } from '../../command.js';
import {
  FeedbackMust,
  FeedbackScope,
  appendRejection,
  readOpenOptions,
  sharesFlaw,
  type OpenOption,
  type RejectedOption,
} from '../../ledger/index.js';
import { OPTION_ID, pair, provenancePairs, strings } from '../../ledger/provenance.js';
import { gameDir, workspaceRoot } from '../../outbox.js';

const MUST_FLAG = '--must';

function parseMust(raw: unknown): Record<string, string[]> {
  if (raw === undefined) return {};
  if (typeof raw !== 'string') throw new UsageError(`${MUST_FLAG} needs JSON`, `gm help options reject`);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new UsageError(`${MUST_FLAG} is not valid JSON`, `gm help options reject`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    throw new UsageError(`${MUST_FLAG} must be a JSON object`, `gm help options reject`);
  return json as Record<string, string[]>;
}

/** The rejected options as named on the command line, carrying the provenance given or the one already shown. */
function rejectedOptions(flags: Record<string, unknown>, root: string, open: OpenOption[]): RejectedOption[] {
  const provenance = provenancePairs(flags, root);
  const options = strings(flags, 'option').map((value) => {
    const [id, label] = pair(value, 'option');
    const shown = open.find((candidate) => candidate.id === id);
    const carried = provenance.get(id) ?? shown?.provenance;
    return {
      id,
      label,
      ...(carried === undefined ? {} : { provenance: carried }),
    } satisfies RejectedOption;
  });
  for (const id of provenance.keys()) {
    if (!options.some((option) => option.id === id))
      throw new UsageError(`provenance names unknown option "${id}"`, 'name it with --option <id>=<label>');
  }
  return options;
}

/** An open option shares the flaw when it is the same id, or was built by the same generator from the same packs. */
function sharesRejection(rejected: RejectedOption[], option: OpenOption): boolean {
  return rejected.some(
    (candidate) =>
      candidate.id === option.id ||
      (candidate.provenance !== undefined &&
        option.provenance !== undefined &&
        sharesFlaw(candidate.provenance, option.provenance)),
  );
}

export const command: GmCommand = {
  name: 'options reject',
  summary: 'record a creator rejection in design/feedback.json and withdraw the options and Commands it invalidates',
  usage: '--words <creator words> --rule <derived rule> --scope <characters|look|options> [options]',
  example:
    'options reject --words "those are not characters" --rule "characters are rigged KayKit models" --scope characters --must \'{"packs":["kaykit"]}\' --option a=Stand-in --command cp_01JBX2R1A2B3C4D5E6F7G8H9JK',
  flags: {
    words: { type: 'string', help: "the creator's words, verbatim" },
    rule: { type: 'string', help: 'the rule derived from those words' },
    scope: { type: 'string', help: 'characters, look, or options (all options)' },
    must: { type: 'string', help: 'machine-checkable requirement as JSON, e.g. {"packs":["kaykit"]}' },
    option: { type: 'string', multiple: true, help: 'rejected option id and label; repeat as needed' },
    provenance: { type: 'string', multiple: true, help: 'option id and its provenance JSON or @file' },
    command: { type: 'string', help: 'the Command (command id) the rejected options were shown under' },
    media: { type: 'string', multiple: true, help: 'chat message id of the rejected media; repeat as needed' },
    'design-version': { type: 'string', help: 'the design version the game carried (default 0.0.0)' },
    withdraw: { type: 'string', multiple: true, help: 'an open option id this rejection invalidates' },
    'withdraw-command': { type: 'string', multiple: true, help: 'an open Command id this rejection invalidates' },
    job: { type: 'string', help: 'build job id whose open options are scanned for the flaw' },
  },
  async run(ctx, _args, flags) {
    const words = typeof flags.words === 'string' ? flags.words.trim() : '';
    if (!words) throw new UsageError('--words is required', 'gm options reject --words "<creator words>"');
    const rule = typeof flags.rule === 'string' ? flags.rule.trim() : '';
    if (!rule) throw new UsageError('--rule is required', 'gm options reject --rule "<derived rule>"');
    const scope = FeedbackScope.safeParse(typeof flags.scope === 'string' ? flags.scope.trim() : '');
    if (!scope.success)
      throw new UsageError('--scope needs characters, look, or options', 'gm options reject --scope look');
    const must = FeedbackMust.safeParse(parseMust(flags.must));
    if (!must.success)
      throw new UsageError(`--must is not a valid requirement: ${must.error.message}`, 'gm help options reject');
    const commandId = typeof flags.command === 'string' ? flags.command.trim() : '';
    if (commandId && !/^[A-Za-z0-9_-]{1,128}$/.test(commandId))
      throw new UsageError(`invalid Command id "${commandId}"`, 'pass the command or decision id');

    const root = workspaceRoot(ctx.cwd);
    const open = readOpenOptions(root, typeof flags.job === 'string' ? flags.job : undefined);
    const rejected = rejectedOptions(flags, root, open);

    // Every open option built the same way as a rejected option shares its flaw; its Command goes with it.
    const withdrawnOptions = new Set(strings(flags, 'withdraw'));
    const withdrawnCommands = new Set(strings(flags, 'withdraw-command'));
    for (const option of open) {
      if (!sharesRejection(rejected, option)) continue;
      withdrawnOptions.add(option.id);
      withdrawnCommands.add(option.command_id);
    }
    for (const id of withdrawnOptions) {
      if (!OPTION_ID.test(id)) throw new UsageError(`invalid withdrawn option id "${id}"`, 'use an option id');
    }

    const { entry, ledger } = appendRejection(gameDir(ctx.cwd, root), {
      words,
      rule,
      scope: scope.data,
      must: must.data,
      designVersion: typeof flags['design-version'] === 'string' ? flags['design-version'] : undefined,
      rejected: { options: rejected, command: commandId || null, media: strings(flags, 'media') },
      withdrawn: { options: [...withdrawnOptions], commands: [...withdrawnCommands] },
    });
    ctx.emit('feedback.reject', { entry: entry.id, scope: entry.scope }, undefined);
    if (ctx.json) ctx.out(JSON.stringify({ entry, entries: ledger.entries.length }));
    else {
      ctx.out(entry.id);
      ctx.out(`rule: ${entry.rule} (${entry.scope})`);
      const nothing = 'nothing open';
      ctx.out(`withdrew options: ${entry.withdrawn.options.join(', ') || nothing}`);
      ctx.out(`withdrew commands: ${entry.withdrawn.commands.join(', ') || nothing}`);
    }
    return EXIT.ok;
  },
};
