import type { DesignDoc } from '@ogm/contracts';
import type { Sqlite } from '@ogm/db';
import { buildSwitchFrom, replay } from '@ogm/design-log';

import type { BaseDocSource } from './base-doc.js';
import { readChain } from './store.js';

export const EMPTY_DESIGN_DOC: DesignDoc = {
  schemaVersion: 1,
  globals: {},
  entities: {},
};
export const EMPTY_BUILD_ID = 'build_00000000000000000000000000';

function buildAtRevision(chain: ReturnType<typeof readChain>, revision: number): string | null {
  const leaf = chain.at(-1)?.branch;
  if (!leaf) return null;
  let buildId = leaf.latestBuildId;
  const leafTransactions = chain.at(-1)?.txs ?? [];
  for (const transaction of [...leafTransactions].sort((left, right) => right.rev - left.rev)) {
    if (transaction.rev <= revision) break;
    const switched = buildSwitchFrom(transaction);
    if (switched) buildId = switched.from === EMPTY_BUILD_ID ? null : switched.from;
  }
  return buildId;
}

export async function snapshotAt(
  sqlite: Sqlite,
  source: BaseDocSource,
  branchId: string,
  requestedRev?: number,
): Promise<{ rev: number; buildId: string | null; doc: DesignDoc }> {
  const chain = readChain(sqlite, branchId);
  const leaf = chain.at(-1)?.branch;
  if (!leaf) throw new Error('design branch has no replay chain');
  const rev = requestedRev === undefined ? leaf.headRev : Math.min(requestedRev, leaf.headRev);
  const buildId = buildAtRevision(chain, rev);
  const baseDoc = buildId ? await source.load(leaf.gameId, buildId) : EMPTY_DESIGN_DOC;
  const result = replay({ baseDoc: structuredClone(baseDoc), chain, buildId: buildId ?? undefined }, rev);
  return { rev: result.headRev, buildId, doc: result.doc };
}
