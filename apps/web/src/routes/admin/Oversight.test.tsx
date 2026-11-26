import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Oversight } from './Oversight';
import { adminRequest } from './api';

vi.mock('./api', () => ({
  adminKeys: { builds: () => ['builds'] },
  invalidateAdmin: vi.fn(async () => undefined),
  adminRequest: vi.fn(async () => undefined),
  useAdminBuilds: () => ({
    isPending: false,
    isError: false,
    data: {
      builds: [],
      games: [
        { id: 'g', ownerId: 'o', title: 'Soon', visibility: 'listed', releaseState: 'coming_soon', delistedAt: null },
      ],
      members: [{ userId: 'tester', email: 'tester@example.test' }],
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('grants early access to a selected member', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Oversight />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
  fireEvent.change(screen.getByLabelText('Member'), { target: { value: 'tester' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(adminRequest).toHaveBeenCalledWith('/admin/games/g/early-access/tester', { method: 'PUT' }),
  );
});
