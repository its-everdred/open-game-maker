import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative } from 'node:path';
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
  conflicts_with?: string[];
  compatible_with?: string[];
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
    if (entry.check.kind === 'rule') {
      if (entry.check.id !== 'image-distortion')
        errors.push(`${entry.id}: unregistered gm check rule ${entry.check.id}`);
      else if (
        entry.id !== 'image-distortion' ||
        entry.topic !== 'image-distortion' ||
        entry.value !== 'preserve-aspect-ratio' ||
        entry.scope !== 'all'
      )
        errors.push(`${entry.id}: image-distortion does not enforce this preference`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(Date.parse(`${entry.date}T00:00:00Z`)))
      errors.push(`${entry.id}: invalid date`);
  }
  for (const entry of entries) {
    for (const field of ['conflicts_with', 'compatible_with'] as const) {
      for (const id of entry[field] ?? []) {
        if (id === entry.id || !byId.has(id)) errors.push(`${entry.id}: invalid ${field} ${id}`);
      }
    }
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
      const sameDecision = a.topic === b.topic && a.value !== b.value;
      const overlappingTopics = a.topic.startsWith(`${b.topic}.`) || b.topic.startsWith(`${a.topic}.`);
      const explicitConflict = a.conflicts_with?.includes(b.id) || b.conflicts_with?.includes(a.id);
      const compatible = a.compatible_with?.includes(b.id) || b.compatible_with?.includes(a.id);
      const differentGames = a.scope.startsWith('game:') && b.scope.startsWith('game:') && a.scope !== b.scope;
      if (differentGames) continue;
      if (compatible && (sameDecision || explicitConflict))
        errors.push(`${a.id} and ${b.id}: incompatible relationship declarations`);
      else if (sameDecision || explicitConflict) {
        const recommendation = a.date === b.date ? 'same date' : `recommend ${a.date > b.date ? a.id : b.id}`;
        errors.push(
          `conflict: ${a.id} (${a.date}) “${a.quote}” / ${b.id} (${b.date}) “${b.quote}”; ask the creator; ${recommendation}`,
        );
      } else if (overlappingTopics && !compatible) {
        errors.push(
          `unclassified overlap: ${a.id} (${a.date}) “${a.quote}” / ${b.id} (${b.date}) “${b.quote}”; classify or ask the creator`,
        );
      }
    }
  }
  return { active, errors };
}

const nonempty = z.string().trim().min(1);
const preferenceSchema = z
  .object({
    id: nonempty,
    date: z.iso.date(),
    quote: z.string().refine((quote) => quote.trim().length > 0, 'quote must not be empty'),
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
    conflicts_with: z.array(nonempty).optional(),
    compatible_with: z.array(nonempty).optional(),
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
        const path = join(directory, name);
        if (!lstatSync(path).isFile()) throw new Error(`${name}: preference must be a regular file`);
        const entry = preferenceSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
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

/** Escape Liquid raw-block terminators without changing the rendered creator quotation. */
export function renderPromptPreferenceSection(entries: Preference[]): string {
  return renderPreferenceSection(entries).replace(
    /\{%[-\s]*endraw[-\s]*%\}/gi,
    (tag) => `{% endraw %}{{ ${JSON.stringify(tag)} }}{% raw %}`,
  );
}

function preferenceSection(skill: string): string | undefined {
  const starts = skill.match(/<!-- preferences:start -->/g) ?? [];
  const ends = skill.match(/<!-- preferences:end -->/g) ?? [];
  if (starts.length !== 1 || ends.length !== 1) return undefined;
  return /<!-- preferences:start -->[\s\S]*?<!-- preferences:end -->/.exec(skill)?.[0];
}

export function checkPreferenceSection(entries: Preference[], skillPath: string): string[] {
  const skill = readFileSync(skillPath, 'utf8');
  return preferenceSection(skill) === renderPreferenceSection(entries) ? [] : ['gm-core preference section is stale'];
}

export function checkPromptPreferenceSection(entries: Preference[], promptPath: string): string[] {
  const section = preferenceSection(readFileSync(promptPath, 'utf8'));
  return section === renderPromptPreferenceSection(entries) ? [] : ['daemon prompt preference section is stale'];
}

export function updatePromptPreferenceSection(prompt: string, entries: Preference[]): string {
  const section = preferenceSection(prompt);
  if (!section) throw new CommandError('daemon prompt preference section markers are missing or duplicated');
  return prompt.replace(section, () => renderPromptPreferenceSection(entries));
}

export function updatePreferenceSection(skill: string, entries: Preference[]): string {
  const section = preferenceSection(skill);
  if (!section) throw new CommandError('gm-core preference section markers are missing or duplicated');
  return skill.replace(section, () => renderPreferenceSection(entries));
}

export function checkPreferenceBundle(entries: Preference[], directory: string, skillPath: string): string[] {
  const bundled = readPreferences(directory);
  const problems = JSON.stringify(entries) === JSON.stringify(bundled) ? [] : ['bundled preferences are stale'];
  return [...problems, ...checkPreferenceSection(entries, skillPath).map(() => 'bundled preference section is stale')];
}

function installedPreferencePaths(cwd: string): { boundary: string; paths: string[] } {
  let boundary = realpathSync(cwd);
  try {
    boundary = realpathSync(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    // A standalone command or fixture only checks its current directory.
  }
  const paths: string[] = [];
  let current = realpathSync(cwd);
  for (;;) {
    for (const root of ['.agents', '.claude', '.codex']) {
      const path = join(current, root, 'skills', 'gm-core', 'SKILL.md');
      if (existsSync(path)) paths.push(path);
    }
    if (current === boundary || dirname(current) === current) break;
    current = dirname(current);
  }
  return { boundary, paths };
}

export function checkInstalledPreferenceSections(entries: Preference[], cwd: string, required = false): string[] {
  const { paths } = installedPreferencePaths(cwd);
  if (required && paths.length === 0) return ['no installed gm-core skill; install the skill pack first'];
  return paths.flatMap((path) =>
    checkPreferenceSection(entries, path).map(() => `${path}: preference section is stale`),
  );
}

/** Refresh only the generated section, retaining game-specific and injected context. */
export function refreshInstalledPreferenceSections(entries: Preference[], cwd: string): number {
  const { boundary, paths } = installedPreferencePaths(cwd);
  if (paths.length === 0) throw new CommandError('no installed gm-core skill; install the skill pack first');
  const root = realpathSync(boundary);
  const targets = [...new Set(paths.map((path) => realpathSync(path)))];
  for (const target of targets) {
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new CommandError('installed gm-core resolves outside the workspace');
  }
  const changes = targets.map((target) => {
    const skill = readFileSync(target, 'utf8');
    const hasStart = skill.includes('<!-- preferences:start -->');
    const hasEnd = skill.includes('<!-- preferences:end -->');
    if (hasStart !== hasEnd) throw new CommandError(`${target}: incomplete preference section markers`);
    const updated = hasStart
      ? updatePreferenceSection(skill, entries)
      : `${skill.trimEnd()}\n\n${renderPreferenceSection(entries)}\n`;
    return { target, updated };
  });
  for (const { target, updated } of changes) writeFileSync(target, updated);
  return changes.length;
}
