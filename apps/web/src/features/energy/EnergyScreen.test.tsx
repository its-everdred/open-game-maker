import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EnergyView } from '@ogm/contracts/browser';

import { queryClient } from '../../app/query';
import { energyRefusalText } from './api';
import { parseLimits } from './EnergyAdmin';
import { EnergyScreen } from './EnergyScreen';

const baseView: EnergyView = {
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
  sources: [],
};
// Readings as the NUC reported them on 2026-11-22: Claude fresh, Codex stale, ElevenLabs fresh.
const sources: EnergyView['sources'] = [
  {
    id: 'claude:seven_day',
    label: 'Claude',
    usedPercent: 53,
    resetsAt: '2026-11-27T09:00:00.000Z',
    basis: 'reported',
    observedAt: '2026-11-22T22:07:20.000Z',
    stale: false,
  },
  {
    id: 'codex:codex:primary',
    label: 'Codex',
    usedPercent: null,
    resetsAt: '2026-11-25T16:28:48.000Z',
    basis: 'unknown',
    observedAt: '2026-11-22T05:07:24.000Z',
    stale: true,
  },
  { id: 'fal', label: 'fal', usedPercent: 20, resetsAt: null, basis: 'estimate', observedAt: null, stale: false },
];

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

function serve(role: 'admin' | 'none', view: EnergyView = baseView) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    if (path === '/me') return Response.json({ platformRole: role });
    if (path === '/energy/preference') return Response.json({ ...view, preference: body.preference });
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

  it('lists each provider reading with its reset and basis, and a stale one as unknown with its age', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-22T22:10:00.000Z') });
    serve('none', { ...baseView, sources });
    await screen.findByRole('heading', { name: 'Energy: Healthy' });
    const lines = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(lines).toContainEqual(expect.stringMatching(/^Claude47% left.*resets Nov 27 · reported$/));
    // The stale 97 % is not shown as a share: it reads Unknown with its age, never 0 % or 100 % left.
    expect(lines).toContainEqual(expect.stringMatching(/^CodexUnknown.*resets Nov 25 · unknown · 17 h old$/));
    expect(lines).toContainEqual(expect.stringMatching(/^fal80% left.*estimate$/));
    expect(document.body.textContent).not.toContain('$');
    vi.useRealTimers();
  });

  it('saves the Save / Balanced / Best preference', async () => {
    const calls = serve('none');
    expect(await screen.findByRole('radio', { name: 'Balanced' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Save Energy' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Save Energy' })).toBeChecked());
    expect(calls).toContainEqual({ method: 'PUT', path: '/energy/preference', body: { preference: 'save' } });
  });

  // The limits form and costs moved to the admin dashboard (/admin/energy); settings shows an admin the player view.
  it('keeps limits and dollars off the settings screen, even for an admin', async () => {
    const calls = serve('admin');
    await screen.findByRole('heading', { name: 'Energy: Healthy' });
    expect(screen.queryByRole('form', { name: 'Energy limits' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('$');
    expect(calls.map(({ path }) => path)).not.toContain('/energy/admin');
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
