import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { CreatorDecision, DecisionInventory, type DecisionInventory as Inventory } from '@ogm/contracts';

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
  const value = readInventoryJson(file);
  const parsed = DecisionInventory.safeParse(value);
  if (!parsed.success) throw new CommandError(`invalid decision inventory: ${parsed.error.message}`);
  return parsed.data;
}

function readInventoryJson(file: string): unknown {
  if (!existsSync(file)) throw new CommandError(`decision inventory missing: ${file}`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CommandError(`cannot read decision inventory: ${error instanceof Error ? error.message : String(error)}`);
  }
  return value;
}

export function readRenderableInventory(file: string, warn: (message: string) => void): Inventory {
  const value = readInventoryJson(file);
  if (!Array.isArray(value)) throw new CommandError('invalid decision inventory: expected an array');
  const entries: Inventory = [];
  const seen = new Set<string>();
  value.forEach((entry: unknown, index) => {
    const id =
      typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string'
        ? entry.id
        : `index ${index}`;
    const parsed = CreatorDecision.safeParse(entry);
    if (!parsed.success) {
      warn(
        `invalid decision ${id}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      );
    } else if (seen.has(parsed.data.id)) {
      warn(`invalid decision ${id}: duplicate id`);
    } else {
      seen.add(parsed.data.id);
      entries.push(parsed.data);
    }
  });
  return entries;
}

export function writeInventory(file: string, inventory: Inventory): void {
  const checked = DecisionInventory.parse(inventory);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(checked, null, 2)}\n`);
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
}

export function renderInventory(inventory: Inventory): string {
  const areas = new Map<string, CreatorDecision[]>();
  for (const decision of inventory) areas.set(decision.area, [...(areas.get(decision.area) ?? []), decision]);
  const lines = ['# Creator decisions', ''];
  for (const [area, decisions] of [...areas].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${area}`, '');
    if (
      lines.at(-1) !==
      '| ID | Question | Why | Options | Recommendation | Sources | Status | Answer | Answered | Ticket |'
    )
      lines.push(
        '| ID | Question | Why | Options | Recommendation | Sources | Status | Answer | Answered | Ticket |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      );
    for (const decision of decisions) {
      const options = decision.options
        .map((option) =>
          tableCell(`${option.label}${option.media ? ` (${option.media})` : ` (needs ${option.media_needed})`}`),
        )
        .join('<br>');
      const recommendation = `${decision.recommendation}${typeof decision.recommendation_reason === 'string' ? `: ${decision.recommendation_reason}` : ''}`;
      lines.push(
        `| ${tableCell(decision.id)} | ${tableCell(decision.question)} | ${tableCell(decision.why)} | ${options} | ${tableCell(recommendation)} | ${decision.sources.map(tableCell).join('<br>')} | ${decision.status} | ${tableCell(decision.answer ?? '')} | ${decision.answered_at ?? ''} | ${decision.ticket ?? ''} |`,
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
