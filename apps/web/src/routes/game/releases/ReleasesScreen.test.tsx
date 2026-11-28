import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Build } from '@ogm/contracts/browser';

import type { VersionBranch } from '../versions/rules';
import { ReleasesScreen } from './ReleasesScreen';

const main: VersionBranch = {
  id: 'branch_main',
  gameId: 'game',
  name: 'main',
  gitRef: 'refs/heads/main',
  forkPoint: null,
  headRev: 4,
  latestBuildId: 'build_main',
  status: 'active',
  createdBy: 'user',
  createdAt: '2026-11-01T00:00:00.000Z',
  version: '2.1.0',
};

const tested: Build = {
  id: 'build_main',
  gameId: 'game',
  branchId: 'branch_main',
  gitSha: 'a'.repeat(40),
  sdkVersion: '1.0.0',
  saveSchemaVersion: 1,
  achievementCatalogHash: 'b'.repeat(64),
  status: 'tested',
  artifact: 'present',
  createdAt: '2026-11-01T01:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReleasesScreen', () => {
  it('offers Publish only on main with its tested latest build', async () => {
    stubReleaseApi([main], [tested]);
    const view = renderScreen('/g/game/releases?v=branch_main');

    expect(await screen.findByRole('button', { name: 'Publish' }, { timeout: 5_000 })).toBeEnabled();

    view.unmount();
    const side = { ...main, id: 'branch_side', name: 'side', latestBuildId: 'build_side' };
    stubReleaseApi([main, side], [{ ...tested, id: 'build_side', branchId: 'branch_side' }]);
    renderScreen('/g/game/releases?v=branch_side');

    expect(await screen.findByRole('heading', { name: 'Releases' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  }, 15_000);

  it('waits for repository visibility before enabling Publish', async () => {
    let resolveGame!: (response: Response) => void;
    const gameResponse = new Promise<Response>((resolve) => {
      resolveGame = resolve;
    });
    stubReleaseApi([main], [tested], { gameResponse });
    renderScreen('/g/game/releases?v=branch_main');

    const publish = await screen.findByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();

    await act(async () =>
      resolveGame(
        json({
          id: 'game',
          familyId: 'family',
          ownerId: 'user',
          title: 'Goblin Cellar',
          visibility: 'private',
          repoVisibility: 'public',
        }),
      ),
    );

    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    expect(await screen.findByText('These words will be public.')).toBeVisible();
  });

  it('does not describe an unavailable release history as empty', async () => {
    stubReleaseApi([main], [tested], { releaseStatus: 503 });
    renderScreen('/g/game/releases?v=branch_main');

    expect(await screen.findByRole('alert')).toHaveTextContent('Releases unavailable');
    expect(screen.queryByText('Nothing published yet.')).not.toBeInTheDocument();
  });

  it('shows the checks and source build for a publish attempt', async () => {
    stubReleaseApi([main], [tested]);
    renderScreen('/g/game/releases?v=branch_main');
    expect(await screen.findByRole('heading', { name: 'Publish checks' })).toBeVisible();
    expect(screen.getByText(/pnpm run test: passed/)).toBeVisible();
    expect(screen.getByText(/Build build_main/)).toBeVisible();
    expect(screen.getByText(/390x844/)).toBeVisible();
  });
});

function renderScreen(entry: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/g/:gameId/releases" element={<ReleasesScreen />} />
          <Route path="/g/:gameId" element={<p>Game</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubReleaseApi(
  branches: VersionBranch[],
  builds: Build[],
  options: { gameResponse?: Promise<Response>; releaseStatus?: number } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const path = input.toString();
      if (path.endsWith('/branches')) return Promise.resolve(json({ branches }));
      if (path.endsWith('/builds')) return Promise.resolve(json({ builds }));
      if (path.endsWith('/publish-checks'))
        return Promise.resolve(
          json({
            records: [
              {
                id: 'pc_1',
                gitSha: 'a'.repeat(40),
                buildId: 'build_main',
                surface: 'game',
                sizes: ['390x844'],
                checks: [{ name: 'pnpm run test', result: 'passed' }],
                result: 'passed',
                publishResult: 'published',
                createdAt: '2026-11-01T00:00:00Z',
              },
            ],
          }),
        );
      if (path.endsWith('/releases')) {
        const status = options.releaseStatus ?? 200;
        return Promise.resolve(status === 200 ? json({ releases: [] }) : json({ error: 'unavailable' }, status));
      }
      if (path.endsWith('/games/game')) {
        return (
          options.gameResponse ??
          Promise.resolve(
            json({
              id: 'game',
              familyId: 'family',
              ownerId: 'user',
              title: 'Goblin Cellar',
              visibility: 'private',
              repoVisibility: 'private',
            }),
          )
        );
      }
      return Promise.resolve(json({ error: 'not_found' }, 404));
    }),
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
