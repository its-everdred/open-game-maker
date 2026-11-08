import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EnergyAdminView, EnergyView } from '@ogm/contracts/browser';

import { queryClient } from '../../app/query';
import { energyRefusalText } from './api';
import { EnergyScreen, parseLimits } from './EnergyScreen';

const view: EnergyView = {
  level: 'healthy',
  preference: 'balanced',
  windows: [
    { window: 'day', usedPercent: 25, resetsAt: '2026-11-09T08:00:00.000Z' },
    { window: 'week', usedPercent: null, resetsAt: '2026-11-09T08:00:00.000Z' },
    { window: 'month', usedPercent: null, resetsAt: '2026-12-01T08:00:00.000Z' },
  ],
  services: [
    { service: 'voice', usedPercent: null },
    { service: 'images', usedPercent: null },
  ],
};
const adminView: EnergyAdminView = {
  ...view,
  limits: { day: 4_000_000, week: null, month: null, voice: null, images: null },
  usage: { day: 1_000_000, week: 1_000_000, month: 1_000_000, voice: null, images: null },
  resources: [
    {
      label: 'Builds',
      provider: 'aiur',
      kind: 'metered',
      spentMicroUsd: 1_000_000,
      remainingMicroUsd: null,
      resetsAt: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

function serve(role: 'admin' | 'none') {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    if (path === '/me') return Response.json({ platformRole: role });
    if (path === '/energy/admin')
      return role === 'admin' ? Response.json(adminView) : new Response(null, { status: 403 });
    if (path === '/energy/preference') return Response.json({ ...view, preference: body.preference });
    if (path === '/energy/admin/limits') return Response.json({ ...adminView, limits: body });
    return Response.json(view);
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EnergyScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe('EnergyScreen', () => {
  it('shows a player status and percentages, never dollars, and keeps unknown as unknown', async () => {
    serve('none');
    expect(await screen.findByRole('heading', { name: 'Energy: Healthy' })).toBeVisible();
    const page = document.body.textContent ?? '';
    expect(page).toMatch(/Today75% left/);
    expect(page).toMatch(/Voice ?Unknown/);
    expect(page).not.toContain('$');
    expect(screen.queryByRole('form', { name: 'Energy limits' })).not.toBeInTheDocument();
  });

  it('saves the Save / Balanced / Best preference', async () => {
    const calls = serve('none');
    expect(await screen.findByRole('radio', { name: 'Balanced' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Save Energy' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Save Energy' })).toBeChecked());
    expect(calls).toContainEqual({ method: 'PUT', path: '/energy/preference', body: { preference: 'save' } });
  });

  it('lets an admin set overlapping window and service limits and see real costs and providers', async () => {
    const calls = serve('admin');
    const form = await screen.findByRole('form', { name: 'Energy limits' });
    expect(within(form).getByLabelText(/Today/)).toHaveValue('4');
    fireEvent.change(within(form).getByLabelText(/This week/), { target: { value: '20' } });
    fireEvent.change(within(form).getByLabelText(/Images/), { target: { value: '2.5' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/energy/admin/limits',
        body: { day: 4_000_000, week: 20_000_000, month: null, voice: null, images: 2_500_000 },
      }),
    );
    const row = within(screen.getByRole('table', { name: 'Energy resources' })).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent(/Builds\s*aiur\s*metered\s*\$1\.00\s*Unknown/);
  });
});

describe('energy limits and refusals', () => {
  it('treats blank as no limit and refuses anything that is not a dollar amount', () => {
    const blank = { day: '', week: '', month: '', voice: '', images: '' };
    expect(parseLimits({ ...blank, month: '0.5' })).toEqual({
      ...blank,
      day: null,
      week: null,
      voice: null,
      images: null,
      month: 500_000,
    });
    expect(parseLimits({ ...blank, day: '-1' })).toBeNull();
    expect(parseLimits({ ...blank, day: 'lots' })).toBeNull();
  });

  it('explains an Energy refusal in terms of the build', () => {
    expect(energyRefusalText('week')).toBe('This build needs more Energy than is left this week.');
    expect(energyRefusalText(undefined)).toBeUndefined();
  });
});
