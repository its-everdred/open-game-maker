/**
 * Checks a game's ladder plan (copied from references/build-order-template.md) against the five prototype stages.
 *
 *   node .claude/skills/gm-new-game-plan/scripts/check-ladder.ts games/<name>/design/ladder.md
 *
 * Prints one problem per line and exits 1 when the plan is missing a stage, has them out of order, drops a stage's
 * Review or Roles line, or leaves a feature out of a stage. Exits 0 and prints nothing when the plan is complete.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const STAGES = [
  { title: 'Concepts', roles: ['role:game-design', 'role:audio'] },
  { title: 'Dioramas', roles: ['role:3d', 'role:assets'] },
  { title: 'Rendered gameplay clips', roles: ['role:visual'] },
  { title: 'Video to real gameplay', roles: ['role:gameplay', 'role:qa'] },
  { title: 'Gameplay iterations', roles: ['role:gameplay', 'role:qa'] },
] as const;

type Section = { heading: string; lines: string[] };

function sections(markdown: string): Section[] {
  const found: Section[] = [];
  for (const line of markdown.split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading?.[1]) found.push({ heading: heading[1].trim(), lines: [] });
    else found.at(-1)?.lines.push(line);
  }
  return found;
}

/** First-column cells of a section's table, header and separator rows excluded. */
function features(section: Section): string[] {
  return section.lines
    .filter((line) => line.startsWith('|') && !/^\|\s*(Feature\s*\||-)/.test(line))
    .map((line) => line.split('|')[1]?.trim() ?? '')
    .filter(Boolean);
}

/** Problems with a ladder plan; empty when it holds the five stages in order, each complete. */
export function checkLadder(markdown: string): string[] {
  const all = sections(markdown);
  const stageSections = all.filter((section) => /^\d+\. /.test(section.heading));
  const problems: string[] = [];
  const expected = STAGES.map((stage, index) => `${index + 1}. ${stage.title}`);
  const actual = stageSections.map((section) => section.heading);
  if (actual.join('\n') !== expected.join('\n'))
    return [`stages must be, in order: ${expected.join(' → ')} (found: ${actual.join(' → ') || 'none'})`];

  const planned = features(stageSections[0] as Section);
  if (planned.length === 0) problems.push('1. Concepts lists no feature');
  stageSections.forEach((section, index) => {
    const body = section.lines.join('\n');
    if (!/^Review: \S/m.test(body)) problems.push(`${section.heading}: no "Review:" line`);
    const roles = /^Roles: (.+)$/m.exec(body)?.[1] ?? '';
    for (const role of STAGES[index]?.roles ?? [])
      if (!roles.split(/,\s*/).includes(role)) problems.push(`${section.heading}: missing ${role}`);
    const listed = features(section);
    for (const feature of planned)
      if (!listed.includes(feature)) problems.push(`${section.heading}: no row for feature "${feature}"`);
  });
  return problems;
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
