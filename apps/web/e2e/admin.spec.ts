import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { installAuthRoutes } from './fixtures/auth-routes';

const ids = {
  family: 'f_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  game: 'g_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  job: 'j_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  invite: 'i_8f1c2a4e-5b6d-4c7e-9f00-1a2b3c4d5e6f',
  member: 'u_member',
};

const owner = member('u1', 'owner@example.com', 'owner');
const familyMember = member(ids.member, 'member@example.com', 'member');
const game = {
  id: ids.game,
  familyId: ids.family,
  ownerId: 'u1',
  title: 'Moonlight Door',
  visibility: 'private',
  repoVisibility: 'private',
  repo: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  delistedAt: null,
};
const job = {
  id: ids.job,
  gameId: ids.game,
  branchId: 'main',
  familyId: ids.family,
  creatorId: ids.member,
  kind: 'feature',
  complexity: 3,
  state: 'running',
  pausedReason: null,
  start: 'now',
  startAt: null,
  slot: 'edit',
  plan: { title: 'Moonlight Door', summary: 'Add the door.', scope: { included: [], excluded: [] }, tickets: [] },
  reservation: { amountMicroUsd: 400_000, sizeClass: 'medium', confidence: 'low' },
  hardCapMicroUsd: 400_000,
  usageMicroUsd: 250_000,
  aiurRepo: null,
  aiurIssueNumber: 86,
  aiurSpendCapMicroUsd: null,
  idempotencyKey: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:10:00.000Z',
  terminalAt: null,
};

test.use({ serviceWorkers: 'block' });

test('redirects a non-admin session out of the admin surface', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  await installAdminRoutes(page, 'none');

  await page.goto('/admin');

  await expect(page).toHaveURL(/\/all$/);
});

test('protects the owner and confirms member removal', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  const requests = await installAdminRoutes(page);

  await page.goto('/admin/members?test');

  const ownerRow = page.getByText(owner.email).locator('..');
  await expect(ownerRow).not.toContainText('Remove member');
  await activate(page.getByRole('button', { name: `Remove ${familyMember.email}` }));
  expect(requests.memberDeletes).toBe(0);
  await activate(page.getByRole('button', { name: 'Confirm' }));
  await expect.poll(() => requests.memberDeletes).toBe(1);
});

test('shows a responsive build timeline and the complete activity set', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  await installAdminRoutes(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });

  await page.goto(`/admin/builds/${ids.job}?test`);

  await expect(page.getByRole('img', { name: 'Build timeline' })).toBeVisible();
  for (const label of [
    'Asset pipeline',
    'Level building',
    'Gameplay code',
    'Animation & VFX',
    'Audio',
    'UI & HUD',
    'Playtesting',
    'Deploy & release',
    'Writing',
  ]) {
    await expect(page.getByLabel('Activity minutes').getByText(label)).toBeVisible();
  }
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        type AdminWindow = Window & { __ogmHost?: { admin?: { route: string; lastTimeline: unknown } } };
        return (window as AdminWindow).__ogmHost?.admin;
      }),
    )
    .toMatchObject({ route: `/admin/builds/${ids.job}`, lastTimeline: { jobId: ids.job } });
});

test('persists confirmed admin changes, retries failures, and refetches their views', async ({ page }) => {
  test.slow();
  await installAuthRoutes(page, { signedIn: true });
  const requests = await installAdminRoutes(page);

  await page.goto('/admin/invites?test');
  await page.getByLabel('Email').fill('new-member@example.com');
  await activate(page.getByRole('button', { name: 'Create invite' }));
  requests.failInviteCreates = true;
  await activate(page.getByRole('button', { name: 'Confirm' }));
  await expect(page.getByRole('alert')).toHaveText('Change could not be saved. Try again.');
  requests.failInviteCreates = false;
  await activate(page.getByRole('button', { name: 'Confirm' }));
  await expect.poll(() => requests.inviteCreates).toHaveLength(2);
  expect(requests.inviteCreates[1]).toEqual({
    kind: 'member',
    email: 'new-member@example.com',
    capability: 'player',
  });
  // The dialog closes only after the successful mutation has refetched invitations.
  await expect(page.getByRole('alertdialog')).not.toBeVisible({ timeout: 15_000 });
  const inviteRow = page.getByRole('row').filter({ hasText: 'new-member@example.com' });
  await expect(inviteRow).toContainText('pending');
  await activate(inviteRow.getByRole('button', { name: 'Revoke' }));
  await activate(page.getByRole('button', { name: 'Confirm' }));
  await expect.poll(() => requests.inviteRevokes).toBe(1);
  await expect(inviteRow).toContainText('revoked');

  await page.goto('/admin/budgets?test');
  await page.getByLabel('Creation slots').fill('3');
  await activate(page.getByRole('button', { name: 'Save settings' }));
  await activate(page.getByRole('button', { name: 'Confirm' }));
  await expect.poll(() => requests.settingsPatches).toHaveLength(1);
  expect(requests.settingsPatches[0]).toEqual({ resetZone: 'UTC', slots: { new_game: 3, edit: 2 } });
  await expect(page.getByLabel('Creation slots')).toHaveValue('3');

  await page.goto('/admin?test');
  await activate(page.getByRole('button', { name: 'Delist' }));
  await activate(page.getByRole('button', { name: 'Confirm' }));
  await expect.poll(() => requests.delists).toBe(1);
  await expect(page.getByRole('row').filter({ hasText: game.title })).toContainText('delisted');

  const buildsBeforeFlag = requests.buildGets;
  requests.holdFlags = true;
  await activate(page.getByRole('button', { name: 'Flag abuse' }));
  await activate(page.getByRole('button', { name: 'Confirm' }));
  await expect.poll(() => requests.flags).toBe(1);
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  requests.releaseFlag?.();
  await expect(page.getByRole('alertdialog')).not.toBeVisible();
  await expect.poll(() => requests.buildGets).toBeGreaterThan(buildsBeforeFlag);
});

test('keeps primary admin actions at least 64 pixels tall', async ({ page }) => {
  await installAuthRoutes(page, { signedIn: true });
  await installAdminRoutes(page);

  await page.goto('/admin/budgets?test');

  const box = await page.getByRole('button', { name: 'Save settings' }).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(64);
});

async function installAdminRoutes(page: Page, platformRole: 'admin' | 'maintainer' | 'none' = 'admin') {
  const requests = {
    buildGets: 0,
    delists: 0,
    failInviteCreates: false,
    flags: 0,
    holdFlags: false,
    inviteCreates: [] as unknown[],
    inviteRevokes: 0,
    memberDeletes: 0,
    releaseFlag: undefined as undefined | (() => void),
    settingsPatches: [] as unknown[],
  };
  let currentGame = { ...game };
  let currentSettings = { ...settings, slots: { ...settings.slots } };
  let invitations: Array<{
    id: string;
    kind: 'member';
    email: string;
    capability: 'creator' | 'player';
    expiresAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }> = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/v1/me') {
      return json(route, {
        user: { id: 'u1', email: owner.email },
        family: { id: ids.family, name: 'Door Family', role: 'owner', capability: 'creator' },
        platformRole,
      });
    }
    if (path === '/api/v1/admin/members' && request.method() === 'GET') {
      return json(route, { members: [owner, familyMember] });
    }
    if (path === `/api/v1/admin/members/${ids.member}` && request.method() === 'DELETE') {
      requests.memberDeletes += 1;
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === '/api/v1/admin/invites' && request.method() === 'GET') {
      return json(route, { invitations });
    }
    if (path === '/api/v1/invites' && request.method() === 'POST') {
      const payload = request.postDataJSON() as { email: string; capability: 'creator' | 'player' };
      requests.inviteCreates.push(payload);
      if (requests.failInviteCreates) return json(route, { error: 'send_failed' }, 500);
      const invitation = {
        id: ids.invite,
        kind: 'member' as const,
        email: payload.email,
        capability: payload.capability,
        expiresAt: '2026-12-01T00:00:00.000Z',
        acceptedAt: null,
        revokedAt: null,
        createdAt: '2026-11-01T00:00:00.000Z',
      };
      invitations = [invitation, ...invitations];
      return json(route, invitation, 201);
    }
    if (path === `/api/v1/admin/invites/${ids.invite}` && request.method() === 'DELETE') {
      requests.inviteRevokes += 1;
      invitations = invitations.map((invitation) =>
        invitation.id === ids.invite ? { ...invitation, revokedAt: '2026-11-02T00:00:00.000Z' } : invitation,
      );
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === '/api/v1/admin/settings' && request.method() === 'GET') {
      return json(route, currentSettings);
    }
    if (path === '/api/v1/admin/settings' && request.method() === 'PATCH') {
      const payload = request.postDataJSON() as Partial<typeof settings>;
      requests.settingsPatches.push(payload);
      currentSettings = {
        ...currentSettings,
        ...payload,
        slots: payload.slots ? { ...payload.slots } : currentSettings.slots,
      };
      return json(route, currentSettings);
    }
    if (path === '/api/v1/admin/budget') {
      return json(route, {
        familyDayMicroUsd: 300_000,
        platformCapMicroUsd: currentSettings.platformCapMicroUsd,
        resetsAt: '2026-11-02T00:00:00.000Z',
        unitLabel: 'stars',
        microUsdPerUnit: 100_000,
        slots: currentSettings.slots,
        inUse: { new_game: 1, edit: 1 },
        queued: [],
        members: [owner, familyMember],
      });
    }
    if (path === `/api/v1/admin/games/${ids.game}/delist` && request.method() === 'POST') {
      requests.delists += 1;
      currentGame = { ...currentGame, delistedAt: '2026-11-02T00:00:00.000Z' };
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === `/api/v1/admin/games/${ids.game}/flag-abuse` && request.method() === 'POST') {
      requests.flags += 1;
      if (requests.holdFlags) {
        await new Promise<void>((resolve) => {
          requests.releaseFlag = resolve;
        });
      }
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === '/api/v1/admin/games') return json(route, { games: [currentGame] });
    if (path === '/api/v1/admin/builds') {
      requests.buildGets += 1;
      return json(route, {
        builds: [
          { job, game: currentGame, member: { userId: familyMember.userId, email: familyMember.email }, retries: 1 },
        ],
      });
    }
    if (path === `/api/v1/analytics/builds/${ids.job}/timeline`) return json(route, timeline());
    if (path === '/api/v1/analytics/rollups') return json(route, rollup(url));
    if (path === '/api/v1/games') return json(route, { games: [] });
    if (path === '/api/v1/budget/status') return json(route, { unitLabel: 'stars' });
    if (path === '/api/v1/voice/token') return json(route, { error: 'unavailable' }, 503);
    if (path === '/api/v1/notifications/stream') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' });
    }
    return json(route, { error: 'not_mocked', path, method: request.method() }, 404);
  });
  return requests;
}

const settings = {
  familyId: ids.family,
  resetZone: 'UTC',
  unitLabel: 'stars',
  microUsdPerUnit: 100_000,
  platformCapMicroUsd: 1_000_000,
  slots: { new_game: 2, edit: 2 },
  hardCapMultiplier: 2,
  friendsAllowed: false,
};

function member(userId: string, email: string, role: 'owner' | 'member') {
  return {
    userId,
    email,
    role,
    capability: role === 'owner' ? 'creator' : 'player',
    joinedAt: '2026-10-01T00:00:00.000Z',
    dailyMicroUsd: 200_000,
    remainingMicroUsd: 150_000,
  };
}

function timeline() {
  return {
    jobId: ids.job,
    aiur: {
      phases: [
        { phase: 'brainstorm', at: '2026-11-01T09:00:00.000Z' },
        { phase: 'plan', at: '2026-11-01T09:01:00.000Z' },
        { phase: 'work', at: '2026-11-01T09:02:00.000Z' },
        { phase: 'review', at: '2026-11-01T09:09:00.000Z' },
      ],
      usageMicroUsd: 250_000,
      retries: 1,
    },
    activities: [
      {
        activity: 'playtesting',
        actor: 'agent',
        source: 'gm_cli',
        startedAt: '2026-11-01T09:03:00.000Z',
        endedAt: null,
        meta: {},
      },
    ],
    generatedAt: '2026-11-01T09:10:00.000Z',
  };
}

function rollup(url: URL) {
  const byActivity = Object.fromEntries(
    [
      'asset_pipeline',
      'level_building',
      'gameplay_code',
      'animation_vfx',
      'audio',
      'ui_hud',
      'playtesting',
      'deploy_release',
      'writing',
    ].map((activity) => [
      activity,
      { count: activity === 'playtesting' ? 1 : 0, durationMs: activity === 'playtesting' ? 60_000 : 0 },
    ]),
  );
  return {
    scope: url.searchParams.get('scope'),
    id: url.searchParams.get('id'),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    builds: 1,
    usageMicroUsd: 250_000,
    byActivity,
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function activate(locator: Locator) {
  await locator.click();
}
