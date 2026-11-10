import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

import { NewGameScreen } from './NewGameScreen';

const catalog = [
  {
    id: 'isometric-2d',
    label: 'Isometric 2D',
    dimension: '2d',
    fidelity: 'pixel art',
    views: ['iso', 'follow'],
    creationChoice: true,
    coverage: { characters: true, environment: true, props: true, ui: false, sfx: false, music: false },
    packs: [],
    sets: [
      {
        id: 'smallscaleint',
        label: 'SmallScaleInt',
        pickerFamilies: ['pixel-art'],
        vendors: ['smallscaleint'],
        traits: { perspective: 'isometric 2:1', judgment: 'one set' },
        packs: [
          {
            id: 'smallscaleint-knight',
            name: 'Knight',
            thumbnailUrl: '/knight.webp',
            aiGenerated: false,
            compatibleWith: [],
          },
        ],
      },
    ],
  },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/catalog/audio-styles')) {
        return Promise.resolve(
          new Response(JSON.stringify({ families: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(catalog), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'vibrate');
});

function renderScreen(entry = '/new?step=genre') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/new" element={<NewGameScreen />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function button(label: string): HTMLButtonElement {
  return screen.getByText(label, { selector: 'button, button *' }).closest('button') as HTMLButtonElement;
}

describe('NewGameScreen', () => {
  it('uses the prototype three-part wizard header without extra navigation copy', () => {
    const { container } = renderScreen();

    expect(container.querySelector('.new-game-head > .new-head-back')).toContainElement(
      screen.getByRole('button', { name: 'Back' }),
    );
    expect(container.querySelector('.new-game-head > h1')).toHaveTextContent('Genre');
    expect(container.querySelector('.new-game-head > .new-dots')).toHaveAttribute('aria-label', 'Step 1 of 8');
    expect(screen.queryByText(/Create your game|Game setup|Choose a template/)).toBeNull();
  });

  it('shows pick capacity and rejects a fourth pick without text', async () => {
    const vibrate = vi.fn();
    Object.defineProperty(window.navigator, 'vibrate', { configurable: true, value: vibrate });
    renderScreen();

    const capacity = screen.getByRole('img', { name: '0 of 3 picked' });
    expect(capacity.querySelectorAll('.filled')).toHaveLength(0);
    expect(screen.queryByText('Pick up to 3')).not.toBeInTheDocument();

    for (const name of ['Shooter', 'Adventure']) fireEvent.click(button(name));
    expect(capacity).toHaveAccessibleName('2 of 3 picked');
    expect(capacity.querySelectorAll('.filled')).toHaveLength(2);

    fireEvent.click(button('Adventure'));
    expect(capacity).toHaveAccessibleName('1 of 3 picked');
    expect(capacity.querySelectorAll('.filled')).toHaveLength(1);

    for (const name of ['Adventure', 'RPG']) fireEvent.click(button(name));
    expect(capacity).toHaveAccessibleName('3 of 3 picked');
    expect(capacity.querySelectorAll('.filled')).toHaveLength(3);
    fireEvent.click(button('Sports'));
    expect(button('Sports')).toHaveAttribute('aria-pressed', 'false');
    for (const name of ['Shooter', 'Adventure', 'RPG']) expect(button(name)).toHaveClass('new-limit-shake');
    expect(screen.queryByText('Unpick one first.')).not.toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledWith(10);
    await waitFor(
      () => {
        for (const name of ['Shooter', 'Adventure', 'RPG']) expect(button(name)).not.toHaveClass('new-limit-shake');
      },
      { timeout: 600 },
    );
  });

  it('flips Other into a typed value', () => {
    renderScreen();

    fireEvent.click(button('Other'));
    fireEvent.click(screen.getByRole('button', { name: 'Type it' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your own genre' }), { target: { value: 'Delivery' } });
    fireEvent.click(button('Add'));
    expect(screen.getByText('“Delivery”')).toBeVisible();
  }, 20_000);

  it('selects from a catalog family detail and filters point of view', async () => {
    renderScreen();

    fireEvent.click(button('Platformer'));
    fireEvent.click(button('Next'));
    fireEvent.click(button('Skip'));

    const family = await screen.findByRole('button', { name: 'Isometric' });
    expect(screen.queryByText('SmallScaleInt')).not.toBeInTheDocument();
    fireEvent.click(family);
    expect(screen.getByRole('img', { name: 'SmallScaleInt preview' })).toHaveAttribute('src', '/knight.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Select SmallScaleInt' }));
    fireEvent.click(button('Next'));
    fireEvent.click(button('Skip'));
    fireEvent.click(button('Solo'));
    fireEvent.click(button('Next'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Isometric' })).not.toBeInTheDocument();
  });

  it('replaces an Other style with the selected catalog set', async () => {
    renderScreen('/new?step=family');

    fireEvent.click(await screen.findByRole('button', { name: 'Other' }));
    fireEvent.click(screen.getByRole('button', { name: 'Type it' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your own style' }), { target: { value: 'Clay' } });
    fireEvent.click(button('Add'));
    expect(screen.getByText('“Clay”')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Isometric' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select SmallScaleInt' }));
    expect(screen.queryByText('“Clay”')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Isometric' }));
    expect(screen.getByRole('button', { name: 'Select SmallScaleInt' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers a working retry when game creation fails', async () => {
    let createCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith('/api/catalog/style-families')) {
          return Promise.resolve(
            new Response(JSON.stringify(catalog), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (path.endsWith('/api/v1/games')) {
          createCalls += 1;
          return Promise.resolve(
            createCalls === 1
              ? new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
              : new Response(JSON.stringify({ id: 'g_2' }), {
                  status: 201,
                  headers: { 'content-type': 'application/json' },
                }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
      }),
    );
    renderScreen('/new?step=talk');

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(createCalls).toBe(2));
  });

  it('persists an asset-setting change made after game creation starts', async () => {
    const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith('/api/catalog/audio-styles')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                families: [
                  {
                    id: 'chiptune',
                    label: 'Chiptune',
                    styles: [
                      {
                        id: 'chiptune-playful',
                        label: 'Chiptune · Playful',
                        style: 'chiptune',
                        mood: 'playful',
                        sampleUrl: '/sample.wav',
                      },
                    ],
                  },
                ],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        if (path.endsWith('/api/catalog/style-families')) {
          return Promise.resolve(
            new Response(JSON.stringify(catalog), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        if (path.endsWith('/api/v1/games') || path.endsWith('/api/v1/games/g_1')) {
          writes.push({
            path,
            method: init?.method ?? 'GET',
            body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
          });
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'g_1' }), {
              status: path.endsWith('/games') ? 201 : 200,
              headers: { 'content-type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
      }),
    );
    renderScreen('/new?step=talk');

    await waitFor(() => expect(writes.some(({ method }) => method === 'POST')).toBe(true));
    for (const heading of ['Point of view', 'Players', 'World', 'Sound', 'Style']) {
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      await screen.findByRole('heading', { name: heading });
    }
    fireEvent.click(screen.getByRole('switch', { name: 'AI-generated assets' }));

    await waitFor(() =>
      expect(writes).toContainEqual({
        path: expect.stringMatching(/\/api\/v1\/games\/g_1$/),
        method: 'PATCH',
        body: { allowAiGeneratedAssets: false },
      }),
    );
    expect(writes.filter(({ method }) => method === 'POST')).toHaveLength(1);
  });

  it('plays an audio style sample and carries the pick into the next step', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith('/api/catalog/audio-styles')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                families: [
                  {
                    id: 'chiptune',
                    label: 'Chiptune',
                    styles: [
                      {
                        id: 'chiptune-playful',
                        label: 'Chiptune · Playful',
                        style: 'chiptune',
                        mood: 'playful',
                        sampleUrl: '/api/catalog/audio-styles/chiptune-playful/sample',
                      },
                    ],
                  },
                ],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } }),
        );
      }),
    );
    renderScreen('/new?step=sound');

    // A single-mood family opens straight into its sample; play then select the direction.
    fireEvent.click(await screen.findByRole('button', { name: 'Chiptune' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play Chiptune · Playful' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Select Chiptune · Playful' }));

    fireEvent.click(button('Next'));
    expect(await screen.findByRole('heading', { name: 'World' })).toBeVisible();
  });

  it('skips the sound step when no audio style has a montage', async () => {
    renderScreen('/new?step=sound');
    expect(await screen.findByRole('heading', { name: 'World' })).toBeVisible();
  });
});
