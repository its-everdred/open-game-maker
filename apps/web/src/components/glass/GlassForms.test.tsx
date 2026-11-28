import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GlassField, GlassSegmented, GlassSlider } from './GlassForms';
import { GlassInput, GlassTextarea } from './Glass';

it('reports segmented choices and respects disabled options', () => {
  const change = vi.fn();
  render(
    <GlassSegmented
      label="Text size"
      value="medium"
      onValueChange={change}
      options={[
        { value: 'small', label: 'S', ariaLabel: 'Small' },
        { value: 'medium', label: 'M', ariaLabel: 'Medium' },
        { value: 'large', label: 'L', ariaLabel: 'Large', disabled: true },
      ]}
    />,
  );
  expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Small' }));
  fireEvent.click(screen.getByRole('button', { name: 'Large' }));
  expect(change).toHaveBeenCalledExactlyOnceWith('small');
}, 30_000);

it('supports labeled multiline entry', () => {
  render(
    <GlassField id="notes" label="Notes">
      <GlassTextarea id="notes" rows={3} />
    </GlassField>,
  );
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('rows', '3');
}, 30_000);

it('keeps the range input accessible and clamps its displayed value', () => {
  const change = vi.fn();
  const { rerender } = render(<GlassSlider aria-label="Music" min={10} max={90} value={120} onChange={change} />);
  const slider = screen.getByRole('slider', { name: 'Music' });
  expect(slider).toHaveValue('90');
  fireEvent.change(slider, { target: { value: '50' } });
  expect(change).toHaveBeenCalledOnce();
  rerender(<GlassSlider aria-label="Music" min={10} max={90} value={Number.NaN} onChange={change} />);
  expect(slider).toHaveValue('10');
}, 30_000);

it('keeps the fill aligned with stepped and continuous range values', () => {
  const { rerender } = render(<GlassSlider aria-label="Music" min={0} max={10} step={3} value={8} readOnly />);
  const slider = screen.getByRole('slider', { name: 'Music' });
  expect(slider).toHaveValue('9');
  expect(slider).toHaveStyle('--ogm-slider-fill: 90%');
  rerender(<GlassSlider aria-label="Music" min={0} max={10} step="any" value={8} readOnly />);
  expect(slider).toHaveValue('8');
  expect(slider).toHaveStyle('--ogm-slider-fill: 80%');
  rerender(<GlassSlider aria-label="Music" min={0} max={0.3} step={0.1} value={0.3} readOnly />);
  expect(slider).toHaveValue('0.3');
  expect(slider).toHaveStyle('--ogm-slider-fill: 100%');
}, 30_000);

it('connects a field label to its control', () => {
  render(
    <GlassField id="email" label="Email">
      <GlassInput id="email" type="email" />
    </GlassField>,
  );
  expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('type', 'email');
}, 30_000);
