import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EditFrameOrientation, useEditFrameOrientation } from './EditFrameOrientation';

function Example() {
  const { orientation, setOrientation } = useEditFrameOrientation();
  return <EditFrameOrientation orientation={orientation} onChange={setOrientation} />;
}

afterEach(() => vi.unstubAllGlobals());

it('defaults to the orientation that fits the device and preserves a manual override', () => {
  let portrait = true;
  let listener: (() => void) | undefined;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return portrait;
    },
    addEventListener: (_event: string, callback: () => void) => {
      listener = callback;
    },
    removeEventListener: () => {},
  }));
  render(<Example />);
  const wide = screen.getByRole('button', { name: 'Wide game' });
  const vertical = screen.getByRole('button', { name: 'Vertical game' });
  expect(wide.getAttribute('aria-pressed')).toBe('true');
  portrait = false;
  act(() => listener?.());
  expect(vertical.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(wide);
  portrait = true;
  act(() => listener?.());
  portrait = false;
  act(() => listener?.());
  expect(wide.getAttribute('aria-pressed')).toBe('true');
});
