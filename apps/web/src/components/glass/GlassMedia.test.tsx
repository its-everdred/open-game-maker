import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GlassCover, GlassOption } from './GlassMedia';

it('exposes the selected state and suppresses disabled activation', () => {
  const onClick = vi.fn();
  const { rerender } = render(
    <GlassOption label="Adventure" icon="◆" selected={false} accent="warn" onClick={onClick} />,
  );
  const option = screen.getByRole('button', { name: 'Adventure' });
  expect(option).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(option);
  expect(onClick).toHaveBeenCalledOnce();
  rerender(<GlassOption label="Adventure" icon="◆" selected accent="warn" aria-disabled="true" onClick={onClick} />);
  expect(option).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(option);
  expect(onClick).toHaveBeenCalledOnce();
});

it('renders the game title, image and badges in the requested cover format', () => {
  const { container } = render(
    <GlassCover
      title="Blobs VS Blocks"
      image="/cover.png"
      imageAlt="Forest"
      aspect="phone"
      badges={<span>Private</span>}
    />,
  );
  expect(screen.getByRole('img', { name: 'Forest' })).toHaveAttribute('src', '/cover.png');
  expect(screen.getByText('Blobs VS Blocks')).toBeVisible();
  expect(screen.getByText('Private')).toBeVisible();
  expect(container.firstChild).toHaveClass('ogm-cover-phone');
});
