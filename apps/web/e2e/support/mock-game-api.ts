import { readFileSync } from 'node:fs';

import type { Page, Route } from '@playwright/test';

import type { DesignDoc, Patch } from '@ogm/contracts/browser';

import type { TransactionBody } from '../../src/features/editor/api';

export type ScriptedTransactionResult = 'conflict' | 'lease-lost' | 'success';

export type GameApiFixture = {
  readonly attempts: TransactionBody[];
  readonly transactions: TransactionBody[];
  readonly transactionStreamReady: Promise<void>;
  readonly headRev: number;
  script(...results: ScriptedTransactionResult[]): void;
};

export const buildId = 'b_01BX5ZZKBKACTAV9WEVGEMMVRZ';
/* The Draft path starts from the fixture build's folded design, as the API's base doc does for a real build. */
const buildDesign = new URL('../fixtures/bridge-game/design/design.json', import.meta.url);

export async function installGameApi(
  page: Page,
  initialDesign?: DesignDoc,
  title = 'Goblin Cellar',
): Promise<GameApiFixture> {
  let rev = 4;
  let doc = initialDesign ?? (JSON.parse(readFileSync(buildDesign, 'utf8')) as DesignDoc);
  const attempts: TransactionBody[] = [];
  const transactions: TransactionBody[] = [];
  const scripted: ScriptedTransactionResult[] = [];
  let markTransactionStreamReady: () => void = () => undefined;
  const transactionStreamReady = new Promise<void>((resolve) => {
    markTransactionStreamReady = resolve;
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice('/api/v1'.length);
    if (path === '/notifications/stream') return eventStream(route);
    if (path === '/games/game' && request.method() === 'GET') {
      return json(route, {
        id: 'game',
        familyId: 'family',
        ownerId: 'user',
        title,
        visibility: 'private',
        repoVisibility: 'private',
      });
    }
    if (path === '/jobs' && request.method() === 'GET') return json(route, { jobs: [] });
    if (path === '/games/game/workers' && request.method() === 'GET') return json(route, { workers: [] });
    if (path === '/games/game/published') return json(route, { error: 'not_found' }, 404);
    if (path === '/games/game/saves') return json(route, { error: 'not_found' }, 404);
    if (path === '/games/game/branches/main/design' && request.method() === 'GET') {
      return json(route, { rev, buildId, doc });
    }
    if (path === '/games/game/branches/main/lease') {
      if (request.method() === 'POST' || request.method() === 'DELETE') {
        return json(route, { token: 7, expiresAt: '2026-11-02T03:00:00.000Z' });
      }
    }
    if (path === '/games/game/branches/main/lease/heartbeat' && request.method() === 'POST') {
      return json(route, { token: 7, expiresAt: '2026-11-02T03:01:00.000Z' });
    }
    if (path === '/games/game/branches/main/transactions' && request.method() === 'GET') {
      await eventStream(route);
      markTransactionStreamReady();
      return;
    }
    if (path === '/games/game/branches/main/transactions' && request.method() === 'POST') {
      const body = request.postDataJSON() as TransactionBody;
      attempts.push(body);
      const result = scripted.shift() ?? 'success';
      if (result === 'conflict') {
        rev = Math.max(rev + 1, 9);
        return json(route, { headRev: rev }, 409);
      }
      if (result === 'lease-lost') return json(route, { holder: 'other-device' }, 423);
      doc = applyPatches(doc, body.patches);
      rev += 1;
      transactions.push(body);
      return json(route, { rev });
    }
    return json(route, { error: 'not_mocked', path, method: request.method() }, 404);
  });

  return {
    attempts,
    transactions,
    transactionStreamReady,
    get headRev() {
      return rev;
    },
    script: (...results) => scripted.push(...results),
  };
}

function applyPatches(doc: DesignDoc, patches: readonly Patch[]): DesignDoc {
  const next = structuredClone(doc) as Record<string, unknown>;
  for (const patch of patches) {
    let parent = next;
    for (const segment of patch.path.slice(0, -1)) {
      parent = parent[String(segment)] as Record<string, unknown>;
    }
    const key = String(patch.path.at(-1));
    if (patch.op === 'remove') delete parent[key];
    else parent[key] = structuredClone(patch.value);
  }
  return next as DesignDoc;
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function eventStream(route: Route): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 60000\n\n' });
}
