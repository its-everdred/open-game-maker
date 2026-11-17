import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SwipeVerdict } from './SwipeVerdict';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('lets a right swipe be undone before the verdict is sent', async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <SwipeVerdict disabled={false} onSend={send}>
      <div>Media</div>
    </SwipeVerdict>,
  );
  fireEvent.pointerDown(screen.getByText('Media'), { clientX: 10, clientY: 10, isPrimary: true });
  fireEvent.pointerUp(screen.getByText('Media'), { clientX: 120, clientY: 10 });
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(send).not.toHaveBeenCalled();
});

it('opens notes on a left swipe and sends them after the undo window', async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <SwipeVerdict disabled={false} onSend={send}>
      <div>Media</div>
    </SwipeVerdict>,
  );
  fireEvent.pointerDown(screen.getByText('Media'), { clientX: 120, clientY: 10, isPrimary: true });
  fireEvent.pointerUp(screen.getByText('Media'), { clientX: 10, clientY: 10 });
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Try blue' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send changes' }));
  expect(send).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(send).toHaveBeenCalledWith('needs_work', 'Try blue');
});

it('opens an image on tap without sending a verdict', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <SwipeVerdict disabled={false} onSend={send}>
      <div className="review-deck-playable">
        <img src="/art.png" alt="Artwork" />
      </div>
    </SwipeVerdict>,
  );
  const image = screen.getByAltText('Artwork');
  fireEvent.pointerDown(image, { clientX: 10, clientY: 10, isPrimary: true });
  fireEvent.pointerUp(image, { clientX: 10, clientY: 10 });
  expect(screen.getByRole('dialog', { name: 'Review image' })).toBeVisible();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Review image' })).toBeNull();
});

it('tracks a drag without opening the image, and cancels a swipe when a second finger joins', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <SwipeVerdict disabled={false} onSend={send}>
      <div className="review-deck-playable">
        <img src="/art.png" alt="Artwork" />
      </div>
    </SwipeVerdict>,
  );
  const image = screen.getByAltText('Artwork');
  const surface = image.closest<HTMLElement>('.worker-review-swipe')!;
  fireEvent.pointerDown(image, { pointerId: 1, clientX: 10, clientY: 10, isPrimary: true });
  fireEvent.pointerMove(image, { pointerId: 1, clientX: 40, clientY: 10 });
  expect(surface.style.transform).toContain('translateX(30px)');
  fireEvent.pointerUp(image, { pointerId: 1, clientX: 10, clientY: 10 });
  expect(screen.queryByRole('dialog', { name: 'Review image' })).toBeNull();
  expect(surface.style.transform).toBe('');
  fireEvent.pointerDown(image, { pointerId: 1, clientX: 10, clientY: 10, isPrimary: true });
  fireEvent.pointerDown(image, { pointerId: 2, clientX: 20, clientY: 10, isPrimary: false });
  fireEvent.pointerUp(image, { pointerId: 1, clientX: 150, clientY: 10 });
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it('lets a creator close the notes sheet without sending a verdict', () => {
  const send = vi.fn().mockResolvedValue(undefined);
  render(
    <SwipeVerdict disabled={false} onSend={send}>
      <div>Media</div>
    </SwipeVerdict>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Needs changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: 'Needs changes' })).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
