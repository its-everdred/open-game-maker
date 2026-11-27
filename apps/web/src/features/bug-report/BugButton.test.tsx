import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BugSheet, useBugDraft } from './BugButton';
import { sendReport } from './send';

vi.mock('./send', () => ({ sendReport: vi.fn() }));

function Sheet({ close }: { close(): void }) {
  return <BugSheet draft={useBugDraft()} close={close} />;
}

describe('bug report Energy refusal', () => {
  it('keeps the saved report confirmation visible with the reset when the fix cannot start', async () => {
    vi.mocked(sendReport).mockResolvedValueOnce({
      reportId: 'report',
      pendingBudget: true,
      resetsAt: '2026-11-30T08:00:00.000Z',
    });
    const close = vi.fn();
    render(<Sheet close={close} />);
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'stuck' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Report saved. The interim edit limit is exhausted. The limit resets',
    );
    expect(close).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'another problem' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  }, 60_000);
});
