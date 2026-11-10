import { readFileSync } from 'node:fs';

import { effectiveRights, type RightsBasis } from '@ogm/contracts';
import { describe, expect, it } from 'vitest';

import { LICENSES, licenseFor, type LicenseRow } from '../src/licenses.js';

const emitted = JSON.parse(readFileSync(new URL('../data/licenses.json', import.meta.url), 'utf8')) as unknown;

/** The basis a card built from this row carries: the licence entry, plus the strict default while unconfirmed. */
function basisFor(row: LicenseRow): RightsBasis[] {
  const { forbids, ...ceiling } = row.ceiling;
  const licence: RightsBasis = {
    type: 'license',
    license: row.id,
    ref: row.ref,
    ...ceiling,
    ...(forbids ? { forbids } : {}),
    set_by: { role: 'intake-code' },
    date: row.confirmed?.on ?? '2026-11-01',
    ...(row.confirmed ? { confirmed_by: row.confirmed.by } : {}),
  };
  if (row.confirmed) return [licence];
  const strict: RightsBasis = {
    type: 'default',
    uses: ['vision-input'],
    audience: 'private',
    redistribution: 'none',
    set_by: { role: 'intake-code' },
    date: '2026-11-01',
  };
  return [licence, strict];
}

describe('licence table', () => {
  it('keeps data/licenses.json identical to the table, so the Python migration never reads stale ceilings', () => {
    expect(emitted).toEqual(JSON.parse(JSON.stringify(LICENSES)));
  });

  it('keeps every vendor-licensed row local-only: paid bytes never go to cloud processing', () => {
    for (const row of LICENSES.filter((r) => r.id.startsWith('LicenseRef-') || r.id === 'NOASSERTION')) {
      expect(row.processing, row.id).toBe('local-only');
    }
  });

  it('resolves every catalog licence value to one row', () => {
    expect(licenseFor('synty-personal')?.id).toBe('LicenseRef-synty-personal');
    expect(licenseFor('sidetrax-royalty-free')?.id).toBe('LicenseRef-sidetrax-royalty-free');
    expect(licenseFor('LimeZu-commercial')?.id).toBe('LicenseRef-limezu-commercial');
    expect(licenseFor('smallscaleint-itch')?.id).toBe('LicenseRef-smallscaleint-itch');
    expect(licenseFor('ansimuz-free-commercial')?.id).toBe('LicenseRef-ansimuz-free');
    expect(licenseFor('custom-commercial-ok')?.id).toBe('LicenseRef-hattap-commercial');
    expect(licenseFor('CC0-1.0')?.id).toBe('CC0-1.0');
    expect(licenseFor('kaykit')?.id).toBe('CC0-1.0');
    expect(licenseFor('kenney')?.id).toBe('CC0-1.0');
    expect(licenseFor('angais-pixel-art-atlas')).toMatchObject({
      id: 'CC0-1.0',
      pack_notes: { 'angais-pixel-art-atlas': expect.stringContaining('Krea 2 Community License') },
    });
    expect(licenseFor('made-up')).toBeUndefined();
  });

  it('stores a SHA-256 whitelist value for exact Kenney licence-text matching', () => {
    expect(licenseFor('kenney')?.license_text_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps SmallScaleInt private, local-only, and distributable only in builds', () => {
    const row = licenseFor('smallscaleint-itch');
    expect(row).toMatchObject({
      id: 'LicenseRef-smallscaleint-itch',
      processing: 'local-only',
      ceiling: { audience: 'private', redistribution: 'in-build' },
    });
  });

  it('gives each confirmed row its ceiling through the rights engine, and each unconfirmed row only the strict default', () => {
    for (const row of LICENSES) {
      const effective = effectiveRights(basisFor(row));
      const expected = row.confirmed
        ? row.ceiling
        : { uses: ['vision-input'], audience: 'private', redistribution: 'none' };
      expect({ ...effective, uses: [...effective.uses].sort() }, row.id).toEqual({
        uses: [...expected.uses].sort(),
        audience: expected.audience,
        redistribution: expected.redistribution,
      });
    }
  });
});
