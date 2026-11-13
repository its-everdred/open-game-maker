import type { Branch } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

import {
  BranchArchived,
  BranchNotFound,
  ensureMainBranch,
  findBranch,
  insertBranch,
  listBranches as listStoredBranches,
  resolveBranch,
  stableId,
} from '../design/store.js';

export const BUILDERS_ON_MAIN_COPY = 'Builders work on the main version';

const CONTROL_CHARACTER = /\p{Cc}/u;

export class CapActive extends Error {
  constructor(readonly active: Branch[]) {
    super('active branch cap reached');
    this.name = 'CapActive';
  }
}

export class NameTaken extends Error {
  constructor() {
    super('branch name is already used by this game');
    this.name = 'NameTaken';
  }
}

export class InvalidBranchName extends Error {
  constructor() {
    super('branch name must be 1-60 characters with no control characters');
    this.name = 'InvalidBranchName';
  }
}

export class MainImmutable extends Error {
  constructor() {
    super('main cannot be changed');
    this.name = 'MainImmutable';
  }
}

function normalizedName(name: string): string {
  const normalized = name.trim();
  const length = [...normalized].length;
  if (length === 0 || length > 60 || [...name].some((character) => CONTROL_CHARACTER.test(character))) {
    throw new InvalidBranchName();
  }
  return normalized;
}

function nameTaken(sqlite: Sqlite, gameId: string, name: string, exceptId?: string): boolean {
  const row = sqlite
    .prepare<[string, string, string], { id: string }>(
      `SELECT id FROM branches
       WHERE game_id = ? AND lower(name) = lower(?) AND id <> ?
       LIMIT 1`,
    )
    .get(gameId, name, exceptId ?? '');
  return row !== undefined;
}

function tableExists(sqlite: Sqlite, name: string): boolean {
  return Boolean(
    sqlite
      .prepare<[string], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function latestBuildGitSha(sqlite: Sqlite, branch: Branch): string | null {
  if (branch.latestBuildId === null || !tableExists(sqlite, 'builds')) return null;
  const row = sqlite
    .prepare<[string, string], { git_sha: string | null }>('SELECT git_sha FROM builds WHERE id = ? AND game_id = ?')
    .get(branch.latestBuildId, branch.gameId);
  return row?.git_sha ?? null;
}

export function createBranch(
  sqlite: Sqlite,
  input: { gameId: string; name: string; fromBranchId?: string; userId: string; forkGitSha?: string },
  options: { id?: string; now?: Date } = {},
): Branch {
  const name = normalizedName(input.name);
  const now = options.now ?? new Date();
  return sqlite
    .transaction(() => {
      ensureMainBranch(sqlite, input.gameId);
      const parent = resolveBranch(sqlite, input.gameId, input.fromBranchId ?? 'main');
      const active = listStoredBranches(sqlite, input.gameId).filter(
        (branch) => branch.name !== 'main' && branch.status === 'active',
      );
      if (active.length >= 5) throw new CapActive(active);
      if (nameTaken(sqlite, input.gameId, name)) throw new NameTaken();

      const id = options.id ?? stableId('b', now);
      return insertBranch(sqlite, {
        id,
        gameId: input.gameId,
        name,
        gitRef: `branch/${id}`,
        forkPoint: {
          parentBranchId: parent.id,
          parentRev: parent.headRev,
          gitSha: input.forkGitSha ?? latestBuildGitSha(sqlite, parent),
        },
        headRev: 0,
        latestBuildId: parent.latestBuildId,
        status: 'active',
        createdBy: input.userId,
        createdAt: now.toISOString(),
      });
    })
    .immediate();
}

export function listBranches(sqlite: Sqlite, gameId: string): Branch[] {
  ensureMainBranch(sqlite, gameId);
  return listStoredBranches(sqlite, gameId);
}

export function getBranch(sqlite: Sqlite, gameId: string, branch: string): Branch {
  return resolveBranch(sqlite, gameId, branch);
}

export function renameBranch(sqlite: Sqlite, gameId: string, branchRef: string, nextName: string): Branch {
  const branch = resolveBranch(sqlite, gameId, branchRef);
  if (branch.name === 'main') throw new MainImmutable();
  if (branch.status !== 'active') throw new BranchArchived();
  const name = normalizedName(nextName);
  if (nameTaken(sqlite, gameId, name, branch.id)) throw new NameTaken();
  sqlite.prepare('UPDATE branches SET name = ? WHERE id = ?').run(name, branch.id);
  return resolveBranch(sqlite, gameId, branch.id);
}

export function setStatus(sqlite: Sqlite, branchId: string, status: Branch['status']): Branch {
  const row = sqlite
    .prepare<[string], { game_id: string; name: string }>('SELECT game_id, name FROM branches WHERE id = ?')
    .get(branchId);
  if (!row) throw new BranchNotFound();
  if (row.name === 'main' && status !== 'active') throw new MainImmutable();
  sqlite.prepare('UPDATE branches SET status = ? WHERE id = ?').run(status, branchId);
  const branch = findBranch(sqlite, row.game_id, branchId);
  if (!branch) throw new BranchNotFound();
  return branch;
}

export function archiveBranch(sqlite: Sqlite, gameId: string, branchRef: string): Branch {
  const branch = resolveBranch(sqlite, gameId, branchRef);
  if (branch.name === 'main') throw new MainImmutable();
  if (branch.status === 'archived') return branch;
  return setStatus(sqlite, branch.id, 'archived');
}
