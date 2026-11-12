import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('../../lib/api/session', () => ({ useSession: () => ({ data: session.data }) }));
const setSound = vi.hoisted(() => vi.fn());
vi.mock('../../lib/sound', () => ({ set: setSound }));
vi.mock('./TitleTown', () => ({ TitleTown: () => null }));
vi.mock('../../app/StudioMenu', () => ({ StudioMenu: () => null }));
vi.mock('../../lib/input', async () => {
  const actual = await vi.importActual<typeof import('../../lib/input')>('../../lib/input');
  return { ...actual, useInitialFocus: vi.fn(), useFocusable: () => ({ ref: vi.fn() }) };
});

import { TitleScreen } from './TitleScreen';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderTitle() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <TitleScreen />
              <LocationProbe />
            </>
          }
        />
        <Route path="/signin" element={<LocationProbe />} />
        <Route path="/all" element={<LocationProbe />} />
        <Route path="/connect/github" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  session.data = undefined;
});

describe('title screen', () => {
  beforeEach(() => {
    session.data = undefined;
  });

  it('stops title music when leaving and starts it again on return', () => {
    const view = renderTitle();
    expect(setSound).toHaveBeenLastCalledWith('title');
    view.unmount();
    expect(setSound).toHaveBeenLastCalledWith('off');
    renderTitle();
    expect(setSound).toHaveBeenLastCalledWith('title');
  });

  it('sends a signed-out creator to sign in and then straight to the games screen', async () => {
    renderTitle();
    screen.getByRole('button', { name: 'Start' }).click();
    // No GitHub connect step: the instance operator installed the App on the instance repository once.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/signin?next=%2Fall'));
  });

  it('sends a signed-in creator to the games screen', async () => {
    session.data = { user: { id: 'u1' } };
    renderTitle();
    screen.getByRole('button', { name: 'Start' }).click();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/all'));
  });
});
