import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { VersionControls } from './VersionControls';

describe('VersionControls', () => {
  it('keeps version navigation out of the fixed editor chrome', () => {
    const { rerender } = renderControls('edit');

    expect(screen.queryByRole('group', { name: 'Versions and releases' })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <VersionControls gameId="game" branchId="main" mode="play" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: 'Versions and releases' })).toBeVisible();
  });

  it('closes its containing menu before either play navigation', () => {
    const onNavigate = vi.fn();
    const view = render(
      <MemoryRouter>
        <VersionControls gameId="game" branchId="main" mode="play" onNavigate={onNavigate} />
      </MemoryRouter>,
    );

    const controls = within(view.container);
    fireEvent.click(controls.getByRole('button', { name: 'Versions' }));
    fireEvent.click(controls.getByRole('button', { name: 'Releases' }));

    expect(onNavigate).toHaveBeenCalledTimes(2);
  });
});

function renderControls(mode: 'play' | 'edit') {
  return render(
    <MemoryRouter>
      <VersionControls gameId="game" branchId="main" mode={mode} />
    </MemoryRouter>,
  );
}
