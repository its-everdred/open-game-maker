import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../lib/api/client';
import { WelcomeScreen } from './route';

vi.mock('../../lib/api/client', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('first run', { timeout: 20_000 }, () => {
  it('accepts the invitation before returning to the title', async () => {
    vi.mocked(api).mockResolvedValueOnce({ kind: 'member' });
    render(
      <MemoryRouter initialEntries={['/welcome?invite=test-token']}>
        <Routes>
          <Route path="/welcome" element={<WelcomeScreen />} />
          <Route path="/" element={<h1>Title screen</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Title screen' }, { timeout: 10000 })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/invites/test-token/accept', { method: 'POST' });
  });
  it('checks the invitation again when reopened by another session', async () => {
    vi.mocked(api).mockResolvedValueOnce({ kind: 'member' });
    const view = render(
      <MemoryRouter initialEntries={['/welcome?invite=reopened']}>
        <Routes>
          <Route path="/welcome" element={<WelcomeScreen />} />
          <Route path="/" element={<h1>Title screen</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Title screen' }, { timeout: 10000 });
    view.unmount();
    vi.mocked(api).mockRejectedValueOnce(new Error('wrong account'));
    render(
      <MemoryRouter initialEntries={['/welcome?invite=reopened']}>
        <Routes>
          <Route path="/welcome" element={<WelcomeScreen />} />
          <Route path="/" element={<h1>Title screen</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be accepted');
    expect(api).toHaveBeenCalledTimes(2);
  });
  it('does not offer destinations if the invitation fails', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('offline'));
    render(
      <MemoryRouter initialEntries={['/welcome?invite=bad-token']}>
        <Routes>
          <Route path="/welcome" element={<WelcomeScreen />} />
          <Route path="/" element={<h1>Title screen</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be accepted');
    expect(screen.queryByRole('link', { name: 'Play Blobs' })).not.toBeInTheDocument();
  });
});
