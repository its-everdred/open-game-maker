import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Cover } from './Cover';
import { mergeShowcase } from './showcase';

afterEach(cleanup);

describe('game covers', () => {
  it('uses the prototype scene for a showcase entry', () => {
    const game = mergeShowcase([]).find((entry) => entry.title === 'RestoreBound')!;
    const { container } = render(<Cover game={game} />);
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('RestoreBound')).toBeInTheDocument();
  });
});
