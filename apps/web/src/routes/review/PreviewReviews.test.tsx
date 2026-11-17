import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../../app/query';
import { PreviewCard } from './PreviewReviews';

const frame = vi.hoisted(() => ({ mount: vi.fn(), dispose: vi.fn() }));
vi.mock('../../features/editor/frame', () => ({ mountGameFrame: frame.mount }));
vi.mock('../../lib/api/client', () => ({ api: vi.fn(async () => ({ rev: 0, doc: {} })) }));

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

it('remounts the playable preview when a pending delivery changes the controls', async () => {
  frame.mount.mockImplementation(({ container }: { container: HTMLElement }) => {
    container.append(document.createElement('iframe'));
    return { dispose: frame.dispose };
  });
  const buildId = 'preview-00000000-0000-0000-0000-000000000000';
  const preview = { ticket: '12', buildId, accessId: 'access', createdAt: '2026-01-01' };
  const view = render(
    <QueryClientProvider client={queryClient}>
      <PreviewCard gameId="g" preview={preview} swipe />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(frame.mount).toHaveBeenCalledTimes(1));
  view.rerender(
    <QueryClientProvider client={queryClient}>
      <PreviewCard
        gameId="g"
        preview={{ ...preview, pendingMessage: `Preview review of ${buildId}: needs work.\nFix it` }}
        swipe
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(frame.mount).toHaveBeenCalledTimes(2));
  expect(frame.dispose).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.review-deck-playable-frame iframe')).not.toBeNull();
  expect(screen.getByDisplayValue('Fix it')).toHaveAttribute('readonly');
});
