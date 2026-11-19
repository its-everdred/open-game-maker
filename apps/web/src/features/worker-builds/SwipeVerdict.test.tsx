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
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
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

it('allows a swipe from the video picture while leaving its controls untouched', () => {
  render(
    <SwipeVerdict disabled={false} onSend={vi.fn()}>
      <video controls aria-label="Clip" />
    </SwipeVerdict>,
  );
  const video = screen.getByLabelText('Clip');
  vi.spyOn(video, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 300 } as DOMRect);
  fireEvent.pointerDown(video, { pointerId: 1, clientX: 10, clientY: 100, isPrimary: true });
  fireEvent.pointerUp(video, { pointerId: 1, clientX: 120, clientY: 100 });
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  fireEvent.pointerDown(video, { pointerId: 2, clientX: 10, clientY: 280, isPrimary: true });
  fireEvent.pointerUp(video, { pointerId: 2, clientX: 120, clientY: 280 });
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

it('allows an audio card to be swiped outside its native controls', () => {
  render(
    <SwipeVerdict disabled={false} onSend={vi.fn()}>
      <div className="review-deck-playable" aria-label="Audio card">
        <audio controls aria-label="Sound" />
      </div>
    </SwipeVerdict>,
  );
  const card = screen.getByLabelText('Audio card');
  fireEvent.pointerDown(card, { pointerId: 1, clientX: 10, clientY: 100, isPrimary: true });
  fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 100 });
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
});
