import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from '@ogm/config';

import { CommandError, EXIT, UsageError, type GmContext } from './command.js';
import { findAssetsRoot } from './context.js';
import { makeEmitter } from './events.js';
import { parseFlags } from './flags.js';
import { commandHelp, listHelp } from './help.js';
import { loadCommands, match } from './registry.js';

export type { FlagSpec, GmCommand, GmContext } from './command.js';
export { EXIT, UsageError } from './command.js';
export { postChat, type PostChatOptions } from './commands/chat/post.js';
export { printJson, requireAssetsRoot } from './context.js';
export { loadCommands } from './registry.js';
export {
  checkSkill,
  extractCommands,
  extractSdkNames,
  type SkillReferenceCatalog,
  type SkillReferenceMisses,
} from './skills/lint.js';
export * from './ledger/index.js';

export const COMMANDS_DIR = fileURLToPath(new URL('./commands/', import.meta.url));

export type RunOptions = {
  cwd?: string;
  onTestTimeout?: () => void;
  env?: Record<string, string | undefined>;
  commandsDir?: string;
  home?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
};

const ENV = {
  OGM_ASSETS_ROOT: { kind: 'path', required: false },
  GM_SKILLS_DIR: { kind: 'path', required: false },
  GM_EVENTS_FILE: { kind: 'path', required: false },
  GM_JOB: { kind: 'string', required: false },
  AIUR_HOOK_TICKET_IDENTIFIER: { kind: 'int', required: false },
  AIUR_TICKET_BRANCH: { kind: 'string', required: false },
  OGM_SANDBOX: { kind: 'bool', required: false },
  GM_VERIFY_SOFTWARE_GL: { kind: 'bool', required: false },
  GM_VERIFY_QUEUE: { kind: 'bool', required: false },
  PLAYWRIGHT_BROWSERS_PATH: { kind: 'path', required: false },
  XDG_RUNTIME_DIR: { kind: 'path', required: false },
  OGM_BLOB_ROOT: { kind: 'path', required: false },
  OGM_INTERNAL_URL: { kind: 'url', required: false },
  OGM_HOOK_SECRET_FILE: { kind: 'path', required: false },
  OGM_BLOCKLIST_FILE: { kind: 'path', required: false },
} as const;

export async function run(argv: string[], options: RunOptions = {}): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  const cwd = options.cwd ?? process.cwd();
  const registry = await loadCommands(options.commandsDir ?? COMMANDS_DIR);

  try {
    if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help') {
      const target = argv[0] === 'help' ? argv.slice(1) : [];
      if (target.length === 0) {
        listHelp(registry).forEach(out);
        return EXIT.ok;
      }
      const found = match(registry, target);
      if (!found) throw new UsageError(`unknown command "${target.join(' ')}"`, 'gm help');
      commandHelp(found.command).forEach(out);
      return EXIT.ok;
    }

    const found = match(registry, argv);
    if (!found)
      throw new UsageError(`unknown command "${argv.filter((a) => !a.startsWith('-')).join(' ')}"`, 'gm help');
    const { command, rest } = found;
    const { args, flags } = parseFlags(command.name, command.flags, rest);
    if (flags.help === true) {
      commandHelp(command).forEach(out);
      return EXIT.ok;
    }

    const env = options.env === undefined ? loadEnv('gm', ENV) : loadEnv('gm', ENV, options.env);
    const ctx: GmContext = {
      cwd,
      assetsRoot: findAssetsRoot(cwd, env.OGM_ASSETS_ROOT),
      skillsDir: env.GM_SKILLS_DIR ?? null,
      config: {
        eventsFile: env.GM_EVENTS_FILE,
        jobId: env.GM_JOB,
        aiurIssue: env.AIUR_HOOK_TICKET_IDENTIFIER,
        aiurRunId: env.AIUR_TICKET_BRANCH,
        sandbox: env.OGM_SANDBOX === true,
        verifySoftwareGl: env.GM_VERIFY_SOFTWARE_GL === true,
        verifyQueue: env.GM_VERIFY_QUEUE === true,
        runtimeDir: env.XDG_RUNTIME_DIR,
      },
      onTestTimeout: options.onTestTimeout,
      json: flags.json === true,
      limit: flags.limit as number,
      fields:
        typeof flags.fields === 'string'
          ? flags.fields
              .split(',')
              .map((field) => field.trim())
              .filter(Boolean)
          : null,
      out,
      err,
      emit: makeEmitter(env.GM_EVENTS_FILE, env.GM_JOB),
      blobRoot: env.OGM_BLOB_ROOT ? resolve(cwd, env.OGM_BLOB_ROOT) : null,
      blobApi:
        env.OGM_INTERNAL_URL && env.OGM_HOOK_SECRET_FILE
          ? { url: env.OGM_INTERNAL_URL, secretFile: env.OGM_HOOK_SECRET_FILE }
          : null,
      blocklistFile: env.OGM_BLOCKLIST_FILE ? resolve(cwd, env.OGM_BLOCKLIST_FILE) : null,
      // eslint-disable-next-line no-restricted-properties -- a command's children (git, pnpm) inherit the caller's whole environment
      env: options.env ?? process.env,
      home: options.home ?? homedir(),
    };
    return await command.run(ctx, args, flags);
  } catch (error) {
    if (error instanceof UsageError) {
      err(error.message);
      return EXIT.usage;
    }
    if (error instanceof CommandError) {
      err(error.message);
      return EXIT.failed;
    }
    throw error;
  }
}
