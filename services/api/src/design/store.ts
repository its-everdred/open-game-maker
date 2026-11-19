import { randomBytes } from 'node:crypto';

import type { Branch, Transaction } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';

import { assertLeaseForWrite, LeaseMismatch } from './lease.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

type BranchRow = {
  id: string;
  game_id: string;
  name: string;
  git_ref: string;
  fork_parent_branch_id: string | null;
  fork_parent_rev: number | null;
  fork_git_sha: string | null;
  head_rev: number;
  latest_build_id: string | null;
  status: Branch['status'];
  created_by: string;
  created_at: string;
};

type TransactionRow = {
  id: string;
  game_id: string;
  branch_id: string;
  rev: number;
  base_rev: number;
  lease_token: number;
  actor: string;
  kind: Transaction['kind'];
  label: string;
  base_build_id: string;
  commands_json: string;
  patches_json: string;
  inverse_json: string;
  created_at: string;
};

export type AppendTransactionInput = {
  gameId: Transaction['gameId'];
  branchId: Transaction['branchId'];
  baseRev: Transaction['baseRev'];
  leaseToken: Transaction['leaseToken'];
  actor: Transaction['actor'];
  kind: Transaction['kind'];
  label: Transaction['label'];
  baseBuildId: Transaction['baseBuildId'];
  commands: Transaction['commands'];
  patches: Transaction['patches'];
  inverse: Transaction['inverse'];
  sessionId?: string;
};
export type InsertBranchInput = Branch;

export class StaleBaseRev extends Error {
  readonly headRev: number;

  constructor(headRev: number) {
    super(`stale base revision; branch head is ${headRev}`);
    this.name = 'StaleBaseRev';
    this.headRev = headRev;
  }
}

export class BranchNotFound extends Error {
  constructor() {
    super('design branch not found');
    this.name = 'BranchNotFound';
  }
}

export class BranchArchived extends Error {
  constructor() {
    super('design branch is archived');
    this.name = 'BranchArchived';
  }
}

export function stableId(prefix: string, now: Date): string {
  let value = (BigInt(now.getTime()) << 80n) | BigInt(`0x${randomBytes(10).toString('hex')}`);
  let encoded = '';
  for (let index = 0; index < 26; index += 1) {
    encoded = CROCKFORD[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `${prefix}_${encoded}`;
}

function branchFromRow(row: BranchRow): Branch {
  const forkPoint =
    row.fork_parent_branch_id === null || row.fork_parent_rev === null
      ? null
      : {
          parentBranchId: row.fork_parent_branch_id,
          parentRev: row.fork_parent_rev,
          gitSha: row.fork_git_sha,
        };
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    gitRef: row.git_ref,
    forkPoint,
    headRev: row.head_rev,
    latestBuildId: row.latest_build_id,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function transactionFromRow(row: TransactionRow): Transaction {
  return {
    id: row.id,
    gameId: row.game_id,
    branchId: row.branch_id,
    rev: row.rev,
    baseRev: row.base_rev,
    leaseToken: row.lease_token,
    actor: row.actor,
    kind: row.kind,
    label: row.label,
    baseBuildId: row.base_build_id,
    commands: JSON.parse(row.commands_json) as Transaction['commands'],
    patches: JSON.parse(row.patches_json) as Transaction['patches'],
    inverse: JSON.parse(row.inverse_json) as Transaction['inverse'],
    createdAt: row.created_at,
  };
}

export function findBranch(sqlite: Sqlite, gameId: string, branchId: string): Branch | undefined {
  const row = sqlite
    .prepare<[string, string], BranchRow>('SELECT * FROM branches WHERE game_id = ? AND id = ?')
    .get(gameId, branchId);
  return row ? branchFromRow(row) : undefined;
}

// The branches table must preserve insertion rowids when it is rebuilt.
export function listBranches(sqlite: Sqlite, gameId: string): Branch[] {
  return sqlite
    .prepare<[string], BranchRow>(
      `SELECT * FROM branches
       WHERE game_id = ?
       ORDER BY CASE WHEN name = 'main' THEN 0 ELSE 1 END, created_at ASC, rowid ASC`,
    )
    .all(gameId)
    .map(branchFromRow);
}

export function ensureMainBranch(sqlite: Sqlite, gameId: string, options: { id?: string; now?: Date } = {}): Branch {
  const existing = sqlite
    .prepare<[string], BranchRow>("SELECT * FROM branches WHERE game_id = ? AND name = 'main'")
    .get(gameId);
  if (existing) return branchFromRow(existing);

  const game = sqlite.prepare<[string], { owner_id: string }>('SELECT owner_id FROM games WHERE id = ?').get(gameId);
  if (!game) throw new BranchNotFound();
  const now = options.now ?? new Date();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO branches
         (id, game_id, name, git_ref, head_rev, status, created_by, created_at)
       VALUES (?, ?, 'main', 'refs/heads/main', 0, 'active', ?, ?)`,
    )
    .run(options.id ?? stableId('b', now), gameId, game.owner_id, now.toISOString());

  const row = sqlite
    .prepare<[string], BranchRow>("SELECT * FROM branches WHERE game_id = ? AND name = 'main'")
    .get(gameId);
  if (!row) throw new BranchNotFound();
  return branchFromRow(row);
}

export function resolveBranch(
  sqlite: Sqlite,
  gameId: string,
  branch: string,
  options: { id?: string; now?: Date } = {},
): Branch {
  if (branch === 'main') return ensureMainBranch(sqlite, gameId, options);
  const found = findBranch(sqlite, gameId, branch);
  if (!found) throw new BranchNotFound();
  return found;
}

export function insertBranch(sqlite: Sqlite, branch: InsertBranchInput): Branch {
  sqlite
    .prepare(
      `INSERT INTO branches
         (id, game_id, name, git_ref, fork_parent_branch_id, fork_parent_rev, fork_git_sha,
          head_rev, latest_build_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      branch.id,
      branch.gameId,
      branch.name,
      branch.gitRef,
      branch.forkPoint?.parentBranchId ?? null,
      branch.forkPoint?.parentRev ?? null,
      branch.forkPoint?.gitSha ?? null,
      branch.headRev,
      branch.latestBuildId,
      branch.status,
      branch.createdBy,
      branch.createdAt,
    );
  return branch;
}

function appendTransactionRow(
  sqlite: Sqlite,
  input: AppendTransactionInput,
  options: { id?: string; now: Date },
): Transaction {
  const now = options.now;
  const branch = findBranch(sqlite, input.gameId, input.branchId);
  if (!branch) throw new BranchNotFound();
  if (branch.status !== 'active') throw new BranchArchived();
  if (input.baseRev !== branch.headRev) throw new StaleBaseRev(branch.headRev);

  if (input.kind === 'manual' || input.sessionId !== undefined) {
    if (!input.sessionId) throw new LeaseMismatch();
    assertLeaseForWrite(
      sqlite,
      {
        gameId: input.gameId,
        branchId: input.branchId,
        userId: input.actor,
        sessionId: input.sessionId,
        token: input.leaseToken,
      },
      now,
    );
  } else if (input.leaseToken !== 0) {
    throw new LeaseMismatch();
  }

  const transaction: Transaction = {
    id: options.id ?? stableId('tx', now),
    gameId: input.gameId,
    branchId: input.branchId,
    rev: branch.headRev + 1,
    baseRev: input.baseRev,
    leaseToken: input.leaseToken,
    actor: input.actor,
    kind: input.kind,
    label: input.label,
    baseBuildId: input.baseBuildId,
    commands: input.commands,
    patches: input.patches,
    inverse: input.inverse,
    createdAt: now.toISOString(),
  };
  sqlite
    .prepare(
      `INSERT INTO design_transactions
         (id, game_id, branch_id, rev, base_rev, lease_token, actor, kind, label,
          base_build_id, commands_json, patches_json, inverse_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      transaction.id,
      transaction.gameId,
      transaction.branchId,
      transaction.rev,
      transaction.baseRev,
      transaction.leaseToken,
      transaction.actor,
      transaction.kind,
      transaction.label,
      transaction.baseBuildId,
      JSON.stringify(transaction.commands),
      JSON.stringify(transaction.patches),
      JSON.stringify(transaction.inverse),
      transaction.createdAt,
    );
  sqlite
    .prepare('UPDATE branches SET head_rev = ? WHERE id = ? AND head_rev = ?')
    .run(transaction.rev, branch.id, branch.headRev);
  sqlite.prepare('DELETE FROM reapply_reports WHERE branch_id = ?').run(branch.id);
  return transaction;
}

export function appendTransaction(
  sqlite: Sqlite,
  input: AppendTransactionInput,
  options: { id?: string; now?: Date } = {},
): Transaction {
  const transactionOptions = { ...options, now: options.now ?? new Date() };
  return sqlite.transaction(() => appendTransactionRow(sqlite, input, transactionOptions)).immediate();
}

export function appendBuildSwitch(
  sqlite: Sqlite,
  input: AppendTransactionInput,
  buildId: string,
  options: { id?: string; now?: Date } = {},
): Transaction {
  const transactionOptions = { ...options, now: options.now ?? new Date() };
  return sqlite
    .transaction(() => {
      const transaction = appendTransactionRow(sqlite, input, transactionOptions);
      const updated = sqlite
        .prepare('UPDATE branches SET latest_build_id = ? WHERE id = ? AND head_rev = ?')
        .run(buildId, input.branchId, transaction.rev);
      if (updated.changes !== 1) throw new StaleBaseRev(transaction.rev);
      return transaction;
    })
    .immediate();
}

export function readTransactions(sqlite: Sqlite, branchId: string, afterRev: number, limit = 500): Transaction[] {
  return sqlite
    .prepare<[string, number, number], TransactionRow>(
      `SELECT * FROM design_transactions
       WHERE branch_id = ? AND rev > ?
       ORDER BY rev ASC
       LIMIT ?`,
    )
    .all(branchId, afterRev, limit)
    .map(transactionFromRow);
}

export function findTransaction(sqlite: Sqlite, transactionId: string): Transaction | undefined {
  const row = sqlite
    .prepare<[string], TransactionRow>('SELECT * FROM design_transactions WHERE id = ?')
    .get(transactionId);
  return row ? transactionFromRow(row) : undefined;
}

export function readChain(sqlite: Sqlite, branchId: string): Array<{ branch: Branch; txs: Transaction[] }> {
  const chain: Array<{ branch: Branch; txs: Transaction[] }> = [];
  const visited = new Set<string>();
  let currentId: string | null = branchId;

  while (currentId !== null) {
    if (visited.has(currentId)) throw new Error(`branch fork cycle at ${currentId}`);
    visited.add(currentId);
    const row = sqlite.prepare<[string], BranchRow>('SELECT * FROM branches WHERE id = ?').get(currentId);
    if (!row) throw new BranchNotFound();
    const branch = branchFromRow(row);
    chain.unshift({ branch, txs: readTransactions(sqlite, branch.id, -1, Number.MAX_SAFE_INTEGER) });
    currentId = branch.forkPoint?.parentBranchId ?? null;
  }

  return chain;
}
