import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { inventoryPath, markdownSection, readInventory, ticketDecisionIds } from './decision-inventory.js';
import { waivesPrototypeReview } from './prototype-review.js';

export function checkPrReview(cwd: string, bodyFile: string, base: string): string[] {
  let body: string;
  try {
    body = readFileSync(resolve(cwd, bodyFile), 'utf8');
  } catch (error) {
    return [`cannot read PR body ${bodyFile}: ${error instanceof Error ? error.message : String(error)}`];
  }
  const ids = ticketDecisionIds(body) ?? [];
  const problems: string[] = [];
  let changed: string[] = [];
  try {
    changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    problems.push(`cannot compare PR changes with base ${base}`);
  }
  let file: string;
  try {
    ({ file } = inventoryPath(cwd));
  } catch (error) {
    problems.push(
      `cannot locate the game decision inventory: ${error instanceof Error ? error.message : String(error)}`,
    );
    file = '';
  }
  let inventory: ReturnType<typeof readInventory> | null = null;
  if (existsSync(file)) {
    try {
      inventory = readInventory(file);
      for (const id of ids)
        if (inventory.some((decision) => decision.id === id && decision.status === 'open'))
          problems.push(`creator decision ${id} is still open; raise it with gm decisions raise ${id}`);
    } catch (error) {
      problems.push(`invalid decision inventory: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (ids.length > 0) problems.push('creator decisions are listed but the game decision inventory is missing');

  const visiblePaths = changed.filter(
    (path) =>
      /^(?:src|public|assets|games|apps|packages)\//.test(path) &&
      !/(?:\.test\.|\.spec\.|\/test\/|\/tests\/)/.test(path),
  );
  const reviewSection = markdownSection(body, 'Prototype review') ?? '';
  const hasReview = reviewSection.trim() !== '';
  const waivesReview = waivesPrototypeReview(body);
  if (visiblePaths.length > 0 && !hasReview && !waivesReview)
    problems.push('creator-visible changes need a ## Prototype review section or Prototype review: none');
  if (hasReview) {
    const field = (name: string) => new RegExp(`^${name}\\s*:\\s*(.+)$`, 'im').exec(reviewSection)?.[1]?.trim() ?? '';
    for (const required of ['Play', 'Clip', 'Works now', 'Known limitations', 'Weigh in on'])
      if (!field(required)) problems.push(`Prototype review is missing ${required}`);
    const playLink = /\bhttps?:\/\/\S+/u.exec(field('Play'))?.[0];
    if (playLink && gamesHostLink(playLink))
      problems.push(
        `Prototype review Play links the games host (${playLink}), which opens the browser from the home-screen app; link the game's editor: <app>/g/<gameId>?mode=edit&build=<buildId>`,
      );
    else if (playLink && !namesBuild(playLink))
      problems.push(
        `Prototype review Play (${playLink}) opens the game without the reviewed build; link <app>/g/<gameId>?mode=edit&build=<buildId>`,
      );
    const reviewedIds = field('Weigh in on').match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? [];
    if (reviewedIds.length < 3 || reviewedIds.length > 6)
      problems.push('Prototype review must name 3–6 decision ids under Weigh in on');
    if (inventory) {
      const knownIds = new Set(inventory.map((decision) => decision.id));
      for (const id of reviewedIds)
        if (!knownIds.has(id)) problems.push(`Prototype review names unknown decision ${id}`);
    }
  }
  return problems;
}

/* A build on the games host: its `/g/<gameId>/<buildId>/` path, or the host's port. The editor page is `/g/<gameId>`. */
function gamesHostLink(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return url.port === '10000' || /^\/g\/[^/]+\/[^/]+/u.test(url.pathname);
}

/* A link to a game's page must carry the reviewed build, or it plays the branch head instead. */
function namesBuild(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return true;
  }
  return !url.pathname.startsWith('/g/') || !!url.searchParams.get('build');
}
