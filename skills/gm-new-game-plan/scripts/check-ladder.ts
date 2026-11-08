/**
 * Checks a game's ladder plan (copied from references/build-order-template.md) against the five prototype stages.
 *
 *   node .claude/skills/gm-new-game-plan/scripts/check-ladder.ts games/<name>/design/ladder.md
 *
 * Prints one problem per line and exits 1 when the plan has no filled-in features, is missing a stage, has the stages
 * out of order, changes a stage's Review or Roles line, or has a stage whose rows are not exactly the plan's features,
 * each with a ticket. Exits 0 and prints nothing when the plan is complete.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const STAGES = [
  {
    title: 'Concepts',
    review: 'pick or reject per concept (A/B/C with images and audio)',
    roles: 'role:game-design, role:audio',
  },
  {
    title: 'Dioramas',
    review: '"Keep this diorama, or change one of these?" (diorama beside concept)',
    roles: 'role:3d, role:assets',
  },
  { title: 'Rendered gameplay clips', review: 'pick per clip (phone-ready MP4)', roles: 'role:visual' },
  {
    title: 'Video to real gameplay',
    review: 'play-then-vote cards beside the approved clip',
    roles: 'role:gameplay, role:qa',
  },
  {
    title: 'Gameplay iterations',
    review: 'play-then-vote per variant, one feature at a time',
    roles: 'role:gameplay, role:qa',
  },
] as const;

type Section = { heading: string; lines: string[] };
type Row = Record<string, string>;

function sections(markdown: string): Section[] {
  const found: Section[] = [];
  for (const line of markdown.replace(/\r/g, '').split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading?.[1]) found.push({ heading: heading[1].trim(), lines: [] });
    else found.at(-1)?.lines.push(line);
  }
  return found;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());

/** The rows of a section's first table, keyed by its header cells. */
function rows(section: Section): Row[] {
  const table = section.lines.filter((line) => line.trim().startsWith('|'));
  const header = cells(table[0] ?? '');
  return table
    .slice(1)
    .filter((line) => !/^\|[\s:|-]*$/.test(line.trim()))
    .map((line) => Object.fromEntries(cells(line).map((cell, index) => [header[index] ?? `${index}`, cell])));
}

const isPlaceholder = (cell: string): boolean => /^<.*>$/.test(cell);

/** Problems with a ladder plan; empty when it holds the five stages in order, each complete. */
export function checkLadder(markdown: string): string[] {
  const all = sections(markdown);
  const problems: string[] = [];

  const roster = all.find((section) => section.heading === 'Features');
  const features = roster ? rows(roster).map((row) => row.Feature ?? '') : [];
  if (!roster) problems.push('no "## Features" table');
  else if (features.length === 0 || features.some((feature) => !feature || isPlaceholder(feature)))
    problems.push('Features: fill in one row per feature (no <placeholder> or empty names)');
  if (new Set(features).size !== features.length) problems.push('Features: a feature is listed twice');

  const stageSections = all.filter((section) => /^\d+\. /.test(section.heading));
  const expected = STAGES.map((stage, index) => `${index + 1}. ${stage.title}`);
  const actual = stageSections.map((section) => section.heading);
  if (actual.join('\n') !== expected.join('\n'))
    return [...problems, `stages must be, in order: ${expected.join(' → ')} (found: ${actual.join(' → ') || 'none'})`];

  stageSections.forEach((section, index) => {
    const stage = STAGES[index] as (typeof STAGES)[number];
    const body = section.lines.join('\n');
    if (/^Review: (.*)$/m.exec(body)?.[1]?.trim() !== stage.review)
      problems.push(`${section.heading}: Review line must read "Review: ${stage.review}"`);
    if (/^Roles: (.*)$/m.exec(body)?.[1]?.trim() !== stage.roles)
      problems.push(`${section.heading}: Roles line must read "Roles: ${stage.roles}"`);
    const listed = rows(section);
    const names = listed.map((row) => row.Feature ?? '');
    for (const feature of features)
      if (!names.includes(feature)) problems.push(`${section.heading}: no row for feature "${feature}"`);
    for (const name of names) {
      if (!features.includes(name)) problems.push(`${section.heading}: "${name}" is not in Features`);
      if (names.indexOf(name) !== names.lastIndexOf(name))
        problems.push(`${section.heading}: "${name}" has more than one row`);
    }
    for (const row of listed)
      if (!row.Ticket || isPlaceholder(row.Ticket)) problems.push(`${section.heading}: "${row.Feature}" has no ticket`);
  });
  return [...new Set(problems)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: check-ladder.ts <games/<name>/design/ladder.md>');
    process.exit(2);
  }
  const problems = checkLadder(readFileSync(path, 'utf8'));
  for (const problem of problems) console.log(problem);
  process.exit(problems.length ? 1 : 0);
}
