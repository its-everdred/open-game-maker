import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { CommandError, EXIT, UsageError, type GmCommand } from '../../command.js';
import { workspaceRoot } from '../../outbox.js';

const COMMAND_ID = /^[A-Za-z0-9_-]{1,128}$/;

function answer(file: string): { status: 'answered'; optionId: string } | { status: 'moot' } | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as { status?: unknown; option_id?: unknown };
    if (value.status === 'moot') return { status: 'moot' };
    if (value.status === 'answered' && typeof value.option_id === 'string' && value.option_id)
      return { status: 'answered', optionId: value.option_id };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) {
      // The writer may not have created or finished replacing the file yet.
      return null;
    }
    throw new CommandError(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}

export const command: GmCommand = {
  name: 'command wait',
  summary: 'wait for the creator answer to a command or decision',
  usage: '<command_id|decision_id> [--timeout <seconds>]',
  example: 'command wait cp_01JBX2R1A2B3C4D5E6F7G8H9JK --timeout 600',
  flags: {
    timeout: { type: 'number', default: 600, help: 'seconds to wait before exit 3' },
  },
  async run(ctx, args, flags) {
    if (args.length !== 1 || !COMMAND_ID.test(args[0] ?? ''))
      throw new UsageError('command wait needs one safe command or decision id', 'gm command wait <id>');
    const timeout = typeof flags.timeout === 'number' ? flags.timeout : 600;
    const inbox = join(workspaceRoot(ctx.cwd), '.gm', 'inbox');
    // An answer written before #571 sits in `.gm/inbox/checkpoints/`; read it for one release, with the alias.
    const file = join(inbox, 'commands', `${args[0]}.json`);
    const legacy = join(inbox, 'checkpoints', `${args[0]}.json`);
    const deadline = Date.now() + timeout * 1000;
    for (;;) {
      const found = answer(file) ?? answer(legacy);
      if (found?.status === 'answered') {
        ctx.out(found.optionId);
        return EXIT.ok;
      }
      if (found?.status === 'moot') {
        ctx.err('command is moot');
        return EXIT.moot;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        ctx.err(`no answer after ${timeout} s; make sure the emit_event call was made`);
        return EXIT.timeout;
      }
      await sleep(Math.min(2000, remaining));
    }
  },
};
