import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MountGameFrameOptions } from '../../features/editor/frame';
import { SliceScreen } from './SliceScreen';

// A review slice plays the reviewed build in its scenario, never the branch head or the title screen (#1281). The
// frame is the host's; these tests check what the page asks of it and that nothing loads before the tap.
const mounts: MountGameFrameOptions[] = [];
vi.mock('../../features/editor/frame', () => ({
  mountGameFrame: (options: MountGameFrameOptions) => {
    mounts.push(options);
    return { dispose: () => undefined };
  },
}));

const requests: string[] = [];
beforeEach(() => {
  mounts.length = 0;
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      if (String(input).includes('/artifacts/grant')) return Response.json({ grant: 'grant' });
      return new Response(JSON.stringify({ rev: 3, buildId: 'build_reviewed', doc: { entities: [] } }), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(path: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/g/:gameId/play" element={<SliceScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SliceScreen', () => {
  it('plays the linked build in its scenario after one tap', async () => {
    open('/g/g_blobs/play?build=build_reviewed&scenario=endless%2Fwave-3&seed=7');
    const play = await screen.findByRole('button', { name: 'Play' });
    await waitFor(() => expect(play).toBeEnabled());
    expect(mounts).toEqual([]);
    expect(requests.some((url) => url.includes('/games/g_blobs/builds/build_reviewed/design'))).toBe(true);

    fireEvent.click(play);
    await waitFor(() => expect(mounts).toHaveLength(1));
    expect(mounts[0]).toMatchObject({
      gameId: 'g_blobs',
      buildId: 'build_reviewed',
      draftGrant: 'grant',
      mode: 'play',
      params: { scenario: 'endless/wave-3', seed: '7' },
    });
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });
});
