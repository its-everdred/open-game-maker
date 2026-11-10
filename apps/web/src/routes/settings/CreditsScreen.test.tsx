import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreditsScreen } from './CreditsScreen';
import { SettingsScreen } from './SettingsScreen';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CreditsScreen', () => {
  it('lists aggregated asset packs and shipped software notices', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 1,
          packs: [
            {
              pack: 'open-pack',
              title: 'Open Pack',
              license: 'CC0-1.0',
              licenseSource: 'License.txt',
              attribution: 'none required',
              source: { label: 'Vendor', url: 'https://example.test/open-pack' },
              private: false,
              aiGenerated: true,
            },
            {
              pack: 'small-scale-int',
              title: 'SmallScaleInt Pack',
              license: 'LicenseRef-smallscaleint-personal',
              licenseSource: 'SmallScaleInt licence',
              attribution: 'none required',
              source: { label: 'SmallScaleInt' },
              private: true,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <CreditsScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Open Pack, AI-generated' }, { timeout: 5_000 })).toBeVisible();
    expect(screen.getByText('Licence source: License.txt')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Vendor' })).toHaveAttribute('href', 'https://example.test/open-pack');
    expect(screen.getByRole('heading', { name: 'Open Pack, AI-generated' })).toContainElement(
      screen.getByLabelText('AI-generated'),
    );
    expect(screen.getByText('SmallScaleInt Pack')).toBeVisible();
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
    expect(screen.getByText('Fredoka')).toBeVisible();
    expect(screen.getByText('React')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/api/v1/credits', expect.objectContaining({ credentials: 'include' }));
  });

  it('links the settings screen to the credits route', () => {
    render(
      <MemoryRouter>
        <SettingsScreen />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Credits' })).toHaveAttribute('href', '/settings/credits');
  });
});
