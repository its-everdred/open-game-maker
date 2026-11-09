import type { GmCommand } from './command.js';
import { SHARED_FLAGS } from './flags.js';
import type { Registry } from './registry.js';

export function listHelp(registry: Registry): string[] {
  const names = [...registry.keys()].filter((name) => !registry.get(name)?.hidden).sort();
  const width = Math.max(...names.map((name) => name.length));
  return [
    'usage: gm <command> [args] [--json] [--limit N] [--fields a,b]',
    ...names.map((name) => `  ${name.padEnd(width)}  ${registry.get(name)?.summary ?? ''}`),
    'gm help <command> for flags',
  ];
}

/** At most 15 lines: usage, summary, the command's flags, the shared flags, one example. */
export function commandHelp(command: GmCommand): string[] {
  const flags = Object.entries(command.flags).map(([flag, def]) => {
    const arg = def.type === 'boolean' ? '' : ` <${def.type === 'number' ? 'n' : 'value'}>`;
    const fallback = def.default !== undefined && def.type !== 'boolean' ? ` (default ${String(def.default)})` : '';
    return `  --${flag}${arg}  ${def.help}${fallback}`;
  });
  const shared = Object.keys(SHARED_FLAGS)
    .filter((flag) => flag !== 'help')
    .map((flag) => `--${flag}`)
    .join(' ');
  return [
    `usage: gm ${command.name}${command.usage ? ` ${command.usage}` : ''}`,
    command.summary,
    ...flags,
    `  shared: ${shared} (limit default 10)`,
    ...(command.example ? [`example: gm ${command.example}`] : []),
  ].slice(0, 15);
}
