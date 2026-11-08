import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GameplayToggle } from './GameplaySetting';

// The first render in a jsdom file carries the environment's cold-start cost.
const FIRST_RENDER_MS = 20_000;

afterEach(() => {
  cleanup();
});

describe('paid APIs during gameplay', () => {
  it(
    'shows the stored value and sends the change',
    () => {
      const onChange = vi.fn();
      render(<GameplayToggle allowed={false} busy={false} onChange={onChange} />);
      const box = screen.getByRole('checkbox', { name: 'Allow paid APIs during gameplay' });
      expect(box).not.toBeChecked();
      fireEvent.click(box);
      expect(onChange).toHaveBeenCalledWith(true);
    },
    FIRST_RENDER_MS,
  );

  it('holds still while a change is saving', () => {
    render(<GameplayToggle allowed busy onChange={vi.fn()} />);
    const box = screen.getByRole('checkbox', { name: 'Allow paid APIs during gameplay' });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
  });
});
