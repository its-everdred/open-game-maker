import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BuildTracker } from './BuildTracker';

afterEach(cleanup);

describe('build tracker', () => {
  it('shows the earliest finishing worker and expands each active worker', () => {
    render(
      <BuildTracker
        workers={[
          { ticket: '1', title: 'Forest backdrop', percent: 40, etaSeconds: 30 },
          { ticket: '2', title: 'Boss attack', percent: 80, etaSeconds: 5 },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /2 builds running/ }));
    expect(screen.getByText('Boss attack · about 5s left')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Demo speed' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show each build/ }));
    expect(screen.getByText('Forest backdrop')).toBeVisible();
    expect(screen.getByText('Boss attack')).toBeVisible();
    expect(screen.getByRole('button', { name: /Hide builds/ })).toHaveAttribute('aria-expanded', 'true');
  });
  it('does not invent progress or an ETA when the daemon has no estimate', () => {
    render(<BuildTracker workers={[{ ticket: '1', title: 'New level', percent: null, etaSeconds: null }]} />);
    fireEvent.click(screen.getByRole('button', { name: /1 build running/ }));
    expect(screen.getByText('New level')).toBeVisible();
    expect(screen.queryByText(/left/)).toBeNull();
  });
});
