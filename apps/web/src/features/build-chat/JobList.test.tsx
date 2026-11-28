import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { notifyState } from '../../lib/notify/slice';
import { JobList } from './JobList';
import { buildChatJob } from './test-fixtures';

const cancelJob = vi.hoisted(() => vi.fn());
vi.mock('./jobs', () => ({ cancelJob }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  cancelJob.mockReset();
});

describe('JobList', () => {
  it('shows a queued job position', () => {
    render(
      <MemoryRouter>
        <JobList jobs={[buildChatJob({ state: 'queued', position: 2 })]} unitLabel="coin" onOpen={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Waiting for a build slot: #2')).toBeTruthy();
  });
  it('does not describe a reset-scheduled job as waiting for a slot', () => {
    render(
      <MemoryRouter>
        <JobList
          jobs={[buildChatJob({ state: 'queued', start: 'at_reset', position: 2 })]}
          unitLabel="coin"
          onOpen={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Waiting for a build slot: #2')).toBeNull();
  });
  it('surfaces a cancel failure through the existing toast feed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    cancelJob.mockRejectedValue(new Error('offline'));
    const before = notifyState().toasts.length;
    render(
      <MemoryRouter>
        <JobList jobs={[buildChatJob({ state: 'queued', start: 'at_reset' })]} unitLabel="coin" onOpen={vi.fn()} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(notifyState().toasts).toHaveLength(before + 1));
    expect(notifyState().toasts.at(-1)?.text).toBe('Could not cancel the build. Try again.');
  });
});
