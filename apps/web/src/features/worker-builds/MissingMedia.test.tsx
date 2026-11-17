import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { MissingMedia } from './MissingMedia';
const api = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/client', async (importOriginal) => ({ ...(await importOriginal<object>()), api }));
afterEach(() => {
  cleanup();
  api.mockReset();
});
it('offers retry when the request fails and confirms a successful retry', async () => {
  api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ status: 'asked' });
  render(<MissingMedia path="/review" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Asked the agent for media in the next round.')).toBeVisible();
});
it('reports a changed review without claiming the agent was asked', async () => {
  api.mockRejectedValue(new ApiError(409, {}));
  render(<MissingMedia path="/review" />);
  expect(await screen.findByText('Review changed or media is still loading.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});
