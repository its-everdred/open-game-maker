/**
 * The role check (`skills/gm-core/references/roles.md`): every game ticket carries exactly one `game:<slug>` label and
 * one or more known `role:*` labels, because those labels decide which skills aiur inlines when the ticket starts.
 * The new-game parent (`request:new-game`) is a planning record, never dispatched, so it is not checked. With `game`,
 * a ticket carrying exactly one other game's label belongs to a sibling game in the same instance repo and is skipped.
 */
export type LabelledTicket = { number: number; title?: string; labels: string[] };

export type RoleProblem =
  | { kind: 'no_game' }
  | { kind: 'two_games'; labels: string[] }
  | { kind: 'no_role' }
  | { kind: 'unknown_role'; label: string };

export type RoleReport = { checked: number; failed: { ticket: number; title?: string; problems: RoleProblem[] }[] };

const PARENT = 'request:new-game';

export function checkRoles(tickets: LabelledTicket[], knownRoles: string[], game?: string): RoleReport {
  const failed: RoleReport['failed'] = [];
  let checked = 0;
  for (const ticket of tickets) {
    if (ticket.labels.includes(PARENT)) continue;
    const games = ticket.labels.filter((label) => label.startsWith('game:'));
    if (game !== undefined && games.length === 1 && games[0] !== `game:${game}`) continue;
    checked += 1;
    const problems: RoleProblem[] = [];
    if (games.length === 0) problems.push({ kind: 'no_game' });
    else if (games.length > 1) problems.push({ kind: 'two_games', labels: games });
    const roles = ticket.labels.filter((label) => label.startsWith('role:'));
    for (const label of roles.filter((role) => !knownRoles.includes(role)))
      problems.push({ kind: 'unknown_role', label });
    if (!roles.some((role) => knownRoles.includes(role))) problems.push({ kind: 'no_role' });
    if (problems.length > 0) failed.push({ ticket: ticket.number, title: ticket.title, problems });
  }
  return { checked, failed };
}

export function describeProblem(problem: RoleProblem): string {
  switch (problem.kind) {
    case 'no_game':
      return 'no game:<slug> label';
    case 'two_games':
      return `more than one game label (${problem.labels.join(', ')})`;
    case 'no_role':
      return 'no role:* label from gm-core/references/roles.md';
    case 'unknown_role':
      return `${problem.label} is not a role in gm-core/references/roles.md`;
  }
}
