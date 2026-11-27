import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({ capability: 'player' as 'player' | 'creator' }));
vi.mock('../../lib/api/session', () => ({ useSession: () => ({ data: { user: { id: 'user' } } }) }));
vi.mock('../admin/api', () => ({
  useAdminMe: () => ({ data: { user: { id: 'user' }, capability: access.capability } }),
}));
vi.mock('./NewGameScreen', () => ({ NewGameScreen: () => <p>Creation</p> }));

import { route } from './route';

describe('new game route', () => {
  it('redirects a player who follows a creation link', async () => {
    access.capability = 'player';
    render(
      <MemoryRouter initialEntries={['/new']}>
        <Routes>
          <Route path="/new" element={route.element} />
          <Route path="/all" element={<p>Games</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Games')).toBeVisible();
    expect(screen.queryByText('Creation')).toBeNull();
  });
});
