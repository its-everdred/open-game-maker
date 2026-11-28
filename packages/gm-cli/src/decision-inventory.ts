import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { DecisionInventory, type CreatorDecision, type DecisionInventory as Inventory } from '@ogm/contracts';

import { CommandError } from './command.js';
import { gameDir, workspaceRoot } from './outbox.js';

export function inventoryPath(cwd: string): { file: string; slug: string } {
  const root = workspaceRoot(cwd);
  const slug = basename(gameDir(cwd, root));
  return { file: inventoryFile(root, slug), slug };
}

export function inventoryFile(root: string, slug: string): string {
  const local = join(root, 'games', slug, 'docs', 'decisions.json');
  return existsSync(local) ? local : join(root, 'docs', slug, 'decisions.json');
}

export function readInventory(file: string): Inventory {
  if (!existsSync(file)) throw new CommandError(`decision inventory missing: ${file}`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CommandError(`cannot read decision inventory: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = DecisionInventory.safeParse(value);
  if (!parsed.success) throw new CommandError(`invalid decision inventory: ${parsed.error.message}`);
  return parsed.data;
}

export function writeInventory(file: string, inventory: Inventory): void {
  const checked = DecisionInventory.parse(inventory);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(checked, null, 2)}\n`);
}

export function renderInventory(inventory: Inventory): string {
  const areas = new Map<string, CreatorDecision[]>();
  for (const decision of inventory) areas.set(decision.area, [...(areas.get(decision.area) ?? []), decision]);
  const lines = ['# Creator decisions', ''];
  for (const [area, decisions] of [...areas].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${area}`, '');
    if (lines.at(-1) !== '| ID | Question | Options | Recommendation | Status | Answer | Ticket |')
      lines.push(
        '| ID | Question | Options | Recommendation | Status | Answer | Ticket |',
        '| --- | --- | --- | --- | --- | --- | --- |',
      );
    for (const decision of decisions) {
      const options = decision.options
        .map((option) => `${option.label}${option.media ? ` (${option.media})` : ` (needs ${option.media_needed})`}`)
        .join('<br>');
      lines.push(
        `| ${decision.id} | ${decision.question} | ${options} | ${decision.recommendation} | ${decision.status} | ${decision.answer ?? ''} | ${decision.ticket ?? ''} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function markdownSection(body: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = new RegExp(`^##\\s+${escaped}\\s*\\r?\\n`, 'm').exec(body);
  if (!start) return null;
  const remainder = body.slice(start.index + start[0].length);
  const next = remainder.search(/^##\s/m);
  return next < 0 ? remainder : remainder.slice(0, next);
}

export function ticketDecisionIds(body: string): string[] | null {
  const section = markdownSection(body, 'Creator decisions');
  if (section === null) return null;
  return section
    .split(/\r?\n/)
    .map((line) => /^\s*[-*+]\s+(?:\[[ xX]\]\s*)?`?([A-Za-z][A-Za-z0-9_-]*)`?(?:\b|\s|$)/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined && id.toLowerCase() !== 'none');
}

export function entriesForTicket(inventory: Inventory, ticket: string): CreatorDecision[] {
  return inventory.filter((entry) => entry.ticket === Number(ticket));
}
