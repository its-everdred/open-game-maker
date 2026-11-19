/**
 * Checks a game's ladder plan (copied from references/build-order-template.md) against the five prototype stages.
 *
 *   node .claude/skills/gm-new-game-plan/scripts/check-ladder.ts games/<name>/design/ladder.md
 *
 * Prints one problem per line and exits 1 when the plan has no filled-in features, is missing a stage, has the stages
 * out of order, changes a stage's Review or Roles line, or has a stage whose rows are not exactly the plan's features,
 * each with a ticket. Exits 0 and prints nothing when the plan is complete.
 */
import { readFileSync, realpathSync } from 'node:fs';
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
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

/** The rows of a section's first table, keyed by its header cells. */
function rows(section: Section): Row[] {
  const start = section.lines.findIndex((line) => line.trim().startsWith('|'));
  const end = section.lines.findIndex((line, index) => index > start && !line.trim().startsWith('|'));
  const table = start < 0 ? [] : section.lines.slice(start, end < 0 ? undefined : end);
  const header = cells(table[0] ?? '');
  return table
    .slice(1)
    .filter((line) => !/^\|[\s:|-]*$/.test(line.trim()))
    .map((line) => Object.fromEntries(cells(line).map((cell, index) => [header[index] ?? `${index}`, cell])));
}

const isPlaceholder = (cell: string): boolean => /^`?<[^>]*>`?$/.test(cell);

const knownRoles = new Set(['visual', '3d', 'gameplay', 'audio', 'qa', 'multiplayer', 'game-design', 'assets']);

/** Problems with a ladder plan; empty when it holds the five stages in order, each complete. */
export function checkLadder(markdown: string): string[] {
  const all = sections(markdown);
  const problems: string[] = [];

  const roster = all.find((section) => section.heading === 'Features');
  const rosterRows = roster ? rows(roster) : [];
  const features = rosterRows.map((row) => row.Feature ?? '');
  if (!roster) problems.push('no "## Features" table');
  else if (rosterRows.length === 0 || rosterRows.some((row) => !row.Feature || !row['Flow node']))
    problems.push('Features: fill in one row per feature, each with its flow node');
  let gameLabel: string | undefined;
  const validLabels = (value: string | undefined, required: string[] = []): boolean => {
    const labels = (value ?? '').split(',').map((label) => label.trim());
    const games = labels.filter((label) => /^game:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(label));
    const roles = labels.filter((label) => label.startsWith('role:') && knownRoles.has(label.slice(5)));
    if (games.length !== 1 || roles.length === 0 || labels.length !== games.length + roles.length ||
        new Set(labels).size !== labels.length || !required.every((role) => roles.includes(role))) return false;
    gameLabel ??= games[0];
    return gameLabel === games[0];
  };
  if (rosterRows.some((row) => !validLabels(row.Labels)))
    problems.push('Features: each ticket needs consistent game and known role labels');
  if (new Set(features).size !== features.length) problems.push('Features: a feature is listed twice');

  const media = all.find((section) => section.heading === 'Game media');
  const mediaRows = media ? rows(media) : [];
  for (const [asset, roles] of [
    ['Thumbnail', 'role:visual'],
    ['Loading image', 'role:visual'],
    ['Trailer', 'role:visual, role:audio'],
  ] as const) {
    const matches = mediaRows.filter((row) => row.Asset === asset);
    if (matches.length !== 1) problems.push(`Game media: expected one ${asset} ticket`);
    else {
      const row = matches[0]!;
      if (!row.Ticket || isPlaceholder(row.Ticket)) problems.push(`Game media: ${asset} needs a ticket`);
      if (!validLabels(row.Roles, roles.split(', '))) problems.push(`Game media: ${asset} roles must be ${roles}`);
      if (!row['Blocked by'] || isPlaceholder(row['Blocked by'])) problems.push(`Game media: ${asset} needs blockers`);
    }
  }

  const standard = all.find((section) => section.heading === 'Standard tickets');
  const flow = standard ? rows(standard).filter((row) => row.Asset === 'Flow diagram') : [];
  if (flow.length !== 1 || !flow[0]?.Ticket || isPlaceholder(flow[0].Ticket) ||
      !validLabels(flow[0].Roles, ['role:game-design']) || !flow[0]['Blocked by'] || isPlaceholder(flow[0]['Blocked by']))
    problems.push('Standard tickets: flow diagram needs one ticket, role:game-design and blockers');

  const tickets = new Map<string, string>();
  const stageSections = all.filter((section) => /^[1-5]\. /.test(section.heading));
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
    for (const row of listed) {
      if (!row.Ticket || isPlaceholder(row.Ticket)) problems.push(`${section.heading}: "${row.Feature}" has no ticket`);
      else if (tickets.has(row.Feature ?? '') && tickets.get(row.Feature ?? '') !== row.Ticket)
        problems.push(`${section.heading}: "${row.Feature}" must use the same feature ticket`);
      else tickets.set(row.Feature ?? '', row.Ticket);
    }
  });
  if (new Set(tickets.values()).size !== tickets.size)
    problems.push('Features: each feature needs its own ticket');
  for (const section of all)
    for (const row of rows(section))
      if (Object.values(row).some(isPlaceholder)) problems.push(`${section.heading}: replace every <placeholder>`);
  return [...new Set(problems)];
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: check-ladder.ts <games/<name>/design/ladder.md>');
    process.exit(2);
  }
  let markdown: string;
  try {
    markdown = readFileSync(path, 'utf8');
  } catch {
    console.error(`check-ladder: cannot read ${path}`);
    process.exit(2);
  }
  const problems = checkLadder(markdown);
  for (const problem of problems) console.log(problem);
  process.exit(problems.length ? 1 : 0);
}
