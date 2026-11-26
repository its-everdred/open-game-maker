import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { CommandError } from './command.js';

/** A normalized rule value makes conflicts explicit rather than guessing from prose. */
export interface Preference {
  id: string;
  date: string;
  quote: string;
  source: string;
  scope: string;
  topic: string;
  value: string;
  owner_ticket: number;
  check: { kind: 'review-only'; reason: string } | { kind: 'rule'; id: string };
  status: 'active' | 'superseded';
  supersedes?: string[];
  superseded_by?: string;
}

export function validatePreferences(entries: Preference[]): { active: Preference[]; errors: string[] } {
  const errors: string[] = [];
  if (entries.length === 0) errors.push('preference registry is empty');
  const byId = new Map<string, Preference>();
  for (const entry of entries) {
    if (byId.has(entry.id)) errors.push(`duplicate preference id: ${entry.id}`);
    byId.set(entry.id, entry);
    if (entry.check.kind === 'rule' && entry.check.id !== 'image-distortion')
      errors.push(`${entry.id}: unregistered gm check rule ${entry.check.id}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(Date.parse(`${entry.date}T00:00:00Z`)))
      errors.push(`${entry.id}: invalid date`);
  }
  for (const entry of entries) {
    if ((entry.status === 'superseded') !== Boolean(entry.superseded_by))
      errors.push(`${entry.id}: status and superseded_by disagree`);
    if (entry.superseded_by) {
      const replacement = byId.get(entry.superseded_by);
      if (!replacement || !replacement.supersedes?.includes(entry.id))
        errors.push(`${entry.id}: superseded_by has no reciprocal supersedes`);
      else {
        if (replacement.date <= entry.date) errors.push(`${entry.id}: replacement must be newer`);
        if (replacement.scope !== entry.scope || replacement.topic !== entry.topic)
          errors.push(`${entry.id}: replacement must have the same scope and topic`);
      }
    }
    for (const id of entry.supersedes ?? []) {
      const previous = byId.get(id);
      if (!previous || previous.superseded_by !== entry.id)
        errors.push(`${entry.id}: supersedes ${id} is not reciprocal`);
      else if (entry.date <= previous.date) errors.push(`${entry.id}: replacement must be newer than ${id}`);
    }
  }
  const active = entries.filter((entry) => entry.status === 'active' && !entry.superseded_by);
  for (let i = 0; i < active.length; i++) {
    const a = active[i]!;
    for (const b of active.slice(i + 1)) {
      const overlaps = a.topic === b.topic || a.topic.startsWith(`${b.topic}.`) || b.topic.startsWith(`${a.topic}.`);
      if (a.scope === b.scope && overlaps && a.value !== b.value)
        errors.push(
          `conflict: ${a.id} (${a.date}) “${a.quote}” / ${b.id} (${b.date}) “${b.quote}”; ask the creator, recommending the newest`,
        );
    }
  }
  return { active, errors };
}

const nonempty = z.string().trim().min(1);
const preferenceSchema = z
  .object({
    id: nonempty,
    date: z.iso.date(),
    quote: nonempty,
    source: z.url(),
    scope: z.string().regex(/^(?:all|(?:game|role|lane):[a-z0-9]+(?:-[a-z0-9]+)*)$/),
    topic: nonempty,
    value: nonempty,
    owner_ticket: z.number().int().positive(),
    check: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('review-only'), reason: nonempty }).strict(),
      z.object({ kind: z.literal('rule'), id: nonempty }).strict(),
    ]),
    status: z.enum(['active', 'superseded']),
    supersedes: z.array(nonempty).optional(),
    superseded_by: nonempty.optional(),
  })
  .strict();

export function readPreferences(directory: string): Preference[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const entry = preferenceSchema.parse(JSON.parse(readFileSync(join(directory, name), 'utf8')));
        if (`${entry.id}.json` !== name) throw new Error(`${name}: filename must match preference id`);
        return entry;
      });
  } catch (error) {
    throw new CommandError(`cannot read preferences: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function renderPreferenceSection(entries: Preference[]): string {
  const { active, errors } = validatePreferences(entries);
  if (errors.length) throw new CommandError(errors.join('\n'));
  return [
    '<!-- preferences:start -->',
    '## Creator preferences',
    '',
    'Apply all-game entries and entries matching the ticket game, role or lane. Run `gm prefs check` when the registry changes.',
    ...active.map((entry) => {
      const check = entry.check.kind === 'rule' ? `gm check: ${entry.check.id}` : `review only: ${entry.check.reason}`;
      return `- [${entry.id}](${entry.source}) (${entry.date}, ${entry.scope}; owner #${entry.owner_ticket}; ${check}): “${entry.quote}”`;
    }),
    '<!-- preferences:end -->',
  ].join('\n');
}

export function checkPreferenceSection(entries: Preference[], skillPath: string): string[] {
  const skill = readFileSync(skillPath, 'utf8');
  const section = /<!-- preferences:start -->[\s\S]*?<!-- preferences:end -->/.exec(skill)?.[0];
  return section === renderPreferenceSection(entries) ? [] : ['gm-core preference section is stale'];
}

export function updatePreferenceSection(skill: string, entries: Preference[]): string {
  const pattern = /<!-- preferences:start -->[\s\S]*?<!-- preferences:end -->/;
  if (!pattern.test(skill)) throw new CommandError('gm-core preference section is missing');
  return skill.replace(pattern, () => renderPreferenceSection(entries));
}

export function checkPreferenceBundle(entries: Preference[], directory: string, skillPath: string): string[] {
  const bundled = readPreferences(directory);
  const problems = JSON.stringify(entries) === JSON.stringify(bundled) ? [] : ['bundled preferences are stale'];
  return [...problems, ...checkPreferenceSection(entries, skillPath).map(() => 'bundled preference section is stale')];
}

export function checkInstalledPreferenceSections(entries: Preference[], cwd: string): string[] {
  let boundary = resolve(cwd);
  try {
    boundary = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // A standalone command or fixture only checks its current directory.
  }
  const warnings: string[] = [];
  let current = resolve(cwd);
  for (;;) {
    for (const root of ['.agents', '.claude', '.codex']) {
      const path = join(current, root, 'skills', 'gm-core', 'SKILL.md');
      if (existsSync(path))
        warnings.push(...checkPreferenceSection(entries, path).map(() => `${path}: preference section is stale`));
    }
    if (current === boundary || dirname(current) === current) break;
    current = dirname(current);
  }
  return warnings;
}
