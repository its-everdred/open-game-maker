import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EnergyAdminView, EnergyResource } from '@ogm/contracts/browser';

import { queryClient } from '../../app/query';
import { basisText, EnergyAdmin } from './EnergyAdmin';
import { historyRuns } from './EnergyHistory';

const NOW = '2026-11-22T22:10:00.000Z';

const resource = (fields: Partial<EnergyResource> & Pick<EnergyResource, 'id' | 'label'>): EnergyResource => ({
  provider: fields.id.split('/')[0]!,
  account: null,
  kind: 'subscription_window',
  serves: ['coding'],
  unit: 'percent',
  used: null,
  limit: 100,
  left: null,
  range: null,
  basis: 'unknown',
  resetsAt: null,
  observedAt: null,
  ageMs: null,
  freshness: 'unknown',
  origin: 'aiur.usage',
  editable: false,
  state: 'unknown',
  ...fields,
});

// The NUC on 2026-11-22: Claude fresh at 53 %, Codex stale (97 % 17 hours ago), fal's ledger, no Netlify log.
const view: EnergyAdminView = {
  level: 'healthy',
  preference: 'balanced',
  windows: [
    { window: 'day', usedPercent: 25, resetsAt: '2026-11-23T08:00:00.000Z' },
    { window: 'week', usedPercent: null, resetsAt: '2026-11-23T08:00:00.000Z' },
    { window: 'month', usedPercent: null, resetsAt: '2026-12-01T08:00:00.000Z' },
  ],
  services: [
    { service: 'voice', usedPercent: null },
    { service: 'images', usedPercent: null },
  ],
  sources: [],
  limits: { day: 4_000_000, week: null, month: null, voice: null, images: null },
  usage: { day: 1_000_000, week: 1_000_000, month: 1_000_000, voice: null, images: null },
  pool: {
    binding: {
      id: 'claude/seven_day',
      label: 'Claude',
      leftPercent: 47,
      resetsAt: '2026-11-27T09:00:00.000Z',
      freshness: 'fresh',
    },
  },
  resources: [
    resource({
      id: 'instance/day',
      label: 'Today',
      provider: 'ogm',
      kind: 'cap',
      unit: 'usd',
      used: 1,
      limit: 4,
      left: 3,
      basis: 'estimate',
      origin: 'admin',
      editable: true,
      freshness: 'fresh',
      state: 'available',
    }),
    resource({
      id: 'claude/seven_day',
      label: 'Claude',
      used: 53,
      left: 47,
      basis: 'reported',
      resetsAt: '2026-11-27T09:00:00.000Z',
      observedAt: '2026-11-22T22:07:20.000Z',
      ageMs: 160_000,
      freshness: 'fresh',
      state: 'available',
    }),
    resource({
      id: 'codex/primary',
      label: 'Codex',
      resetsAt: '2026-11-25T16:28:48.000Z',
      observedAt: '2026-11-22T05:07:24.000Z',
      ageMs: 61_355_000,
      freshness: 'stale',
    }),
    resource({
      id: 'fal/ledger',
      label: 'fal',
      kind: 'metered_spend',
      serves: ['images'],
      unit: 'usd',
      used: 1.8,
      limit: 9,
      left: 7.2,
      range: { low: 6.5, high: 7.2 },
      basis: 'estimate',
      origin: 'ogm.ledger',
      freshness: 'fresh',
      state: 'available',
    }),
    resource({
      id: 'netlify/credits',
      label: 'Netlify',
      kind: 'quota',
      unit: 'credits',
      limit: 300,
      serves: ['deploy'],
      origin: 'ogm.ledger',
      editable: true,
    }),
  ],
  caps: [
    {
      id: 'fal/stop',
      label: 'fal stop',
      unit: 'usd',
      limit: 9,
      editable: false,
      origin: 'ogm.ledger',
      layer: 'OGM_FAL_STOP_USD',
    },
    {
      id: 'claude/weekly_usd',
      label: 'Claude weekly limit',
      unit: 'usd',
      limit: 40,
      editable: false,
      origin: 'aiur.capacity',
      layer: 'machine',
    },
    {
      id: 'netlify/credits',
      label: 'Netlify credits a month',
      unit: 'credits',
      limit: 300,
      editable: true,
      origin: 'admin',
      layer: null,
    },
  ],
  history: [
    {
      id: 'claude/seven_day',
      points: [
        { at: '2026-11-22T20:00:00.000Z', left: 50, low: null, high: null, basis: 'reported' },
        { at: '2026-11-22T21:00:00.000Z', left: 48, low: null, high: null, basis: 'reported' },
      ],
    },
  ],
  subscriptions: [
    {
      id: 'claude/plan',
      label: 'Claude',
      planUsdPerMonth: 200,
      weeklyUsd: 46.15,
      usedUsd: { low: 22.01, high: 26.91 },
      basis: 'estimate',
    },
  ],
};

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function serve(status = 200) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace('/api/v1', '');
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: init.method ?? 'GET', path, body });
      if (status !== 200) return new Response(null, { status });
      return Response.json(view);
    }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EnergyAdmin />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

const rowOf = (label: string) =>
  within(screen.getByRole('table', { name: 'Energy resources' }))
    .getByRole('rowheader', { name: label })
    .closest('tr')!;

describe('EnergyAdmin', () => {
  it('heads the page with the pool level and what binds next', async () => {
    serve();
    expect(await screen.findByRole('heading', { name: 'Energy: Healthy' })).toBeVisible();
    expect(screen.getByText(/^Claude · 47% left · resets Nov 27$/)).toBeVisible();
  });

  // A stale or unread figure has no number: never "0%" or "100%", and a stale one keeps its age.
  it('shows unknown and stale rows as Unknown, never as 0 or 100', async () => {
    serve();
    await screen.findByRole('table', { name: 'Energy resources' });
    const codex = rowOf('Codex');
    expect(codex).toHaveTextContent(/^CodexUnknownUnknownNov 25unknownstale 17 hunknown$/);
    expect(rowOf('Netlify')).toHaveTextContent(/^NetlifyUnknown300Unknown/);
    for (const row of [codex, rowOf('Netlify')]) {
      const cells = within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
      expect(cells[0]).toBe('Unknown');
      expect(cells[2]).toBe('Unknown');
    }
    expect(rowOf('Claude')).toHaveTextContent(/^Claude53%47%Nov 27reported2 minavailable$/);
  });

  it('marks every estimate with its range or the word estimate, and calls nothing billed', async () => {
    serve();
    await screen.findByRole('table', { name: 'Energy resources' });
    expect(rowOf('Today')).toHaveTextContent(/estimate/);
    expect(rowOf('fal')).toHaveTextContent(/estimate \$6\.50–\$7\.20/);
    const plans = screen.getByRole('table', { name: 'Subscription spend' });
    expect(within(plans).getByRole('rowheader', { name: 'Claude' }).closest('tr')).toHaveTextContent(
      /^Claude\$46\.15\$22\.01–\$26\.91estimate$/,
    );
    expect(document.body.textContent).not.toMatch(/billed/i);
  });

  it('lets an admin edit OGM caps but shows an aiur cap read-only with its config layer', async () => {
    const calls = serve();
    const form = await screen.findByRole('form', { name: 'Energy caps' });
    const aiur = within(form).getByLabelText(/Claude weekly limit/);
    expect(aiur).toHaveAttribute('readonly');
    expect(within(form).getByText('machine')).toBeVisible();
    expect(within(form).getByLabelText(/fal stop/)).toHaveAttribute('readonly');
    fireEvent.change(within(form).getByLabelText(/Netlify credits/), { target: { value: '1000' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PUT', path: '/energy/admin/caps', body: { 'netlify/credits': 1000 } }),
    );
  });

  it('keeps the window and service limits form', async () => {
    const calls = serve();
    const form = await screen.findByRole('form', { name: 'Energy limits' });
    expect(within(form).getByLabelText(/Today/)).toHaveValue('4');
    fireEvent.change(within(form).getByLabelText(/This week/), { target: { value: '20' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/energy/admin/limits',
        body: { day: 4_000_000, week: 20_000_000, month: null, voice: null, images: null },
      }),
    );
  });

  it('says Not allowed when the API refuses a non-admin', async () => {
    serve(403);
    expect(await screen.findByText('Not allowed')).toBeVisible();
  });
});

describe('energy basis and history', () => {
  it('never shows an estimate without the word estimate', () => {
    expect(basisText({ basis: 'estimate', range: null, unit: 'usd' })).toBe('estimate');
    expect(basisText({ basis: 'estimate', range: { low: 1, high: 2 }, unit: 'usd' })).toBe('estimate $1.00–$2.00');
    expect(basisText({ basis: 'reported', range: null, unit: 'percent' })).toBe('reported');
  });

  it('breaks the line at unknown points and missing hours, and splits reported from estimate', () => {
    const point = (hour: number, left: number | null, basis: 'reported' | 'estimate' | 'unknown' = 'reported') => ({
      at: new Date(Date.parse(NOW) + hour * 3_600_000).toISOString(),
      left,
      low: null,
      high: null,
      basis,
    });
    const runs = historyRuns([
      point(0, 50),
      point(1, 48),
      point(2, null, 'unknown'),
      point(3, 40),
      point(7, 30),
      point(8, 20, 'estimate'),
    ]);
    expect(runs.map(({ kind, points }) => [kind, points.map(({ left }) => left)])).toEqual([
      ['reported', [50, 48]],
      ['reported', [40]],
      ['reported', [30]],
      ['estimate', [20]],
    ]);
  });
});
