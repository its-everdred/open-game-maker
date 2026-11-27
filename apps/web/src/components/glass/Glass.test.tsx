import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GlassButton, GlassInput, GlassOrb, GlassProgress, GlassStatus, GlassSwitch } from './Glass';
import {
  GlassActivityBanner,
  GlassActivityRow,
  GlassMenu,
  GlassMenuItem,
  GlassResourceChip,
  GlassResourceMeter,
  GlassToast,
} from './GlassChrome';

describe('glass controls', () => {
  it('keeps native button and input semantics and labels icon-only actions', () => {
    render(
      <>
        <GlassButton disabled>Play</GlassButton>
        <GlassOrb aria-label="Menu, 2 items" badge={2}>
          icon
        </GlassOrb>
        <label htmlFor="email">Email</label>
        <GlassInput id="email" type="email" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Menu, 2 items' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('type', 'email');
  }, 30_000);
  it('reports switch changes once and respects cancellation and disabled state', () => {
    const change = vi.fn();
    const { rerender } = render(<GlassSwitch aria-label="Voice" checked={false} onCheckedChange={change} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Voice' }));
    expect(change).toHaveBeenCalledExactlyOnceWith(true);
    rerender(
      <GlassSwitch aria-label="Voice" checked onCheckedChange={change} onClick={(event) => event.preventDefault()} />,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Voice' }));
    expect(change).toHaveBeenCalledTimes(1);
    rerender(<GlassSwitch aria-label="Voice" checked disabled onCheckedChange={change} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Voice' }));
    expect(change).toHaveBeenCalledTimes(1);
  });
  it('exposes bounded progress and visible status text', () => {
    const { rerender } = render(
      <>
        <GlassProgress label="Build" value={125} />
        <GlassStatus tone="work">Working</GlassStatus>
      </>,
    );
    expect(screen.getByRole('progressbar', { name: 'Build' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('Working')).toBeVisible();
    rerender(<GlassProgress label="Build" value={Number.NaN} />);
    expect(screen.getByRole('progressbar', { name: 'Build' })).toHaveAttribute('aria-valuenow', '0');
  });
});

it('exposes resource amounts and activity progress to assistive technology', () => {
  const open = vi.fn();
  render(
    <>
      <GlassResourceChip
        minerals={62}
        gas={40}
        mineralIcon={<span>mineral</span>}
        gasIcon={<span>gas</span>}
        onClick={open}
      />
      <GlassActivityBanner endIcon={<span>arrow</span>}>3 agents working</GlassActivityBanner>
      <GlassActivityRow title="Forest road" detail="Placing trees" progress={55} state="work" status="Working" />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Minerals 62%, Gas 40%' }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: '3 agents working' })).toBeVisible();
  expect(screen.getByRole('progressbar', { name: 'Forest road progress' })).toHaveAttribute('aria-valuenow', '55');
  expect(screen.getByText('Working')).toBeVisible();
}, 30_000);

it('does not activate or bubble aria-disabled controls', () => {
  const click = vi.fn();
  const change = vi.fn();
  const parent = vi.fn();
  render(
    <div onClick={parent}>
      <GlassButton aria-disabled="true" onClick={click}>
        Play
      </GlassButton>
      <GlassOrb aria-label="Menu" aria-disabled onClick={click}>
        icon
      </GlassOrb>
      <GlassSwitch aria-label="Voice" aria-disabled checked={false} onCheckedChange={change} />
      <GlassMenuItem aria-disabled onClick={click}>
        Settings
      </GlassMenuItem>
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(click).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
  expect(parent).not.toHaveBeenCalled();
}, 30_000);

it('groups menu actions under an accessible name', () => {
  const open = vi.fn();
  render(
    <GlassMenu label="App menu">
      <GlassMenuItem onClick={open}>Settings</GlassMenuItem>
    </GlassMenu>,
  );
  expect(screen.getByRole('group', { name: 'App menu' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(open).toHaveBeenCalledOnce();
}, 30_000);

it('exposes resource meter details and toast status', () => {
  render(
    <>
      <GlassResourceMeter resource="gas" value={6} icon={<span>rock</span>} detail="Resets Thursday" />
      <GlassToast>Forest road is ready</GlassToast>
    </>,
  );
  expect(screen.getByRole('progressbar', { name: 'Gas remaining' })).toHaveAttribute('aria-valuenow', '6');
  expect(screen.getByText('Resets Thursday')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Forest road is ready');
}, 30_000);
