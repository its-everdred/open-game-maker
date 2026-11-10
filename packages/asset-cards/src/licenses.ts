import type { Audience, Processing, Redistribution, Use } from '@ogm/contracts';

export type LicenseRow = {
  /** The card's `license`: an SPDX id, `NOASSERTION` or a `LicenseRef-*` id. */
  id: string;
  /** Values found in `pack.json` and the catalog that mean this row (originals are never rewritten). */
  aliases: string[];
  ceiling: {
    uses: Use[];
    audience: Audience;
    redistribution: Redistribution;
    attribution: string | null;
    forbids?: Use[];
  };
  /** `local-only` for every `LicenseRef-*` row and `NOASSERTION`. */
  processing: Processing;
  /** Where the terms were read: a file name or a vendor page, never a link with a key or serial. */
  ref: string;
  note: string;
  /** Pack-specific caveats when several sources share one SPDX row. */
  pack_notes?: Record<string, string>;
  /** SHA-256 of a known vendor licence after lower-casing and collapsing whitespace. */
  license_text_sha256?: string;
  /** Omitted = unconfirmed: the strict default basis applies (C3 §5). */
  confirmed?: { by: 'kevin'; on: string };
};

const ALL_USES: Use[] = ['in-game', 'placeholder', 'derive-layout', 'style-reference', 'vision-input'];
const PIXEL_USES: Use[] = ['in-game', 'placeholder', 'style-reference', 'vision-input'];

/** Sorted by id; `pnpm --filter @ogm/asset-cards licenses:emit` writes it to `data/licenses.json`. */
export const LICENSES: LicenseRow[] = [
  {
    id: 'CC0-1.0',
    aliases: ['angais-pixel-art-atlas', 'kaykit', 'kenney'],
    ceiling: { uses: ALL_USES, audience: 'public', redistribution: 'free', attribution: null },
    processing: 'any',
    ref: 'License.txt',
    note: 'CC0 public domain dedication; credit optional.',
    pack_notes: {
      'angais-pixel-art-atlas':
        "CC0 only to the extent of Angais's rights; it does not grant third-party or trademark rights or override the Krea 2 Community License, its commercial-use provisions, or the Krea Acceptable Use Policy.",
    },
    // Kenney Tiny Dungeon 1.0 License.txt, lower-cased with whitespace collapsed.
    license_text_sha256: '0c0f722d36d8d887fe238dd6c25ac42a6711b0d87db7835cc8d90a497271f9fe',
    confirmed: { by: 'kevin', on: '2026-10-26' },
  },
  {
    id: 'LicenseRef-ansimuz-free',
    aliases: ['ansimuz-free-commercial'],
    ceiling: { uses: PIXEL_USES, audience: 'public', redistribution: 'in-build', attribution: 'ansimuz' },
    processing: 'local-only',
    ref: 'ansimuz itch.io store page, copied to License.txt',
    note: 'Free for commercial projects with credit to ansimuz; raw files never redistributed; local processing only.',
    confirmed: { by: 'kevin', on: '2026-10-30' },
  },
  {
    id: 'LicenseRef-hattap-commercial',
    aliases: ['custom-commercial-ok'],
    ceiling: { uses: PIXEL_USES, audience: 'private', redistribution: 'in-build', attribution: null },
    processing: 'local-only',
    ref: 'Hat Tap Games itch.io store page, copied to License.txt',
    note: 'Use in commercial projects; credit appreciated, not required; raw files never redistributed; local processing only.',
    confirmed: { by: 'kevin', on: '2026-10-30' },
  },
  {
    id: 'LicenseRef-itch-custom',
    aliases: [],
    ceiling: {
      uses: ['in-game', 'placeholder', 'vision-input'],
      audience: 'private',
      redistribution: 'in-build',
      attribution: null,
    },
    processing: 'local-only',
    ref: 'itch.io store page, copied to License.txt',
    note: 'An itch.io purchase whose terms have not been read yet; the strict default applies until Kevin confirms a row.',
  },
  {
    id: 'LicenseRef-limezu-commercial',
    aliases: ['LimeZu-commercial'],
    ceiling: { uses: PIXEL_USES, audience: 'private', redistribution: 'in-build', attribution: 'LimeZu' },
    processing: 'local-only',
    ref: 'LimeZu itch.io store page, copied to License.txt',
    note: 'LimeZu licence: commercial or non-commercial use, edits allowed, credit LimeZu, no resale or redistribution.',
    confirmed: { by: 'kevin', on: '2026-10-30' },
  },
  {
    id: 'LicenseRef-smallscaleint-itch',
    aliases: ['smallscaleint-itch'],
    ceiling: { uses: PIXEL_USES, audience: 'private', redistribution: 'in-build', attribution: null },
    processing: 'local-only',
    ref: 'itch.io store page',
    note: 'Private SmallScaleInt purchase; use only in builds, never redistribute raw files, and process locally.',
    confirmed: { by: 'kevin', on: '2026-11-01' },
  },
  {
    id: 'LicenseRef-sidetrax-royalty-free',
    aliases: ['sidetrax-royalty-free'],
    ceiling: {
      uses: ['in-game'],
      audience: 'private',
      redistribution: 'in-build',
      attribution: null,
      forbids: ['edit-audio', 'derive-audio'],
    },
    processing: 'local-only',
    ref: 'https://www.sidetrax.co.uk/page-21/terms.php',
    note: 'Use in games, one user, no redistribution outside the project; editing and derivatives not granted. Kevin interprets vision-input as local models only.',
    confirmed: { by: 'kevin', on: '2026-10-27' },
  },
  {
    id: 'LicenseRef-synty-personal',
    aliases: ['synty-personal'],
    ceiling: { uses: ALL_USES, audience: 'private', redistribution: 'in-build', attribution: null },
    processing: 'local-only',
    ref: 'Synty EULA (personal purchase); B11 policy',
    note: "Kevin's instance and private repos only; raw files never committed or shared. Check the EULA before anything public.",
    confirmed: { by: 'kevin', on: '2026-10-26' },
  },
  {
    id: 'NOASSERTION',
    aliases: [],
    ceiling: { uses: ['vision-input'], audience: 'private', redistribution: 'none', attribution: null },
    processing: 'local-only',
    ref: 'none',
    note: 'No licence found: the strict default basis only.',
  },
];

/** The row whose id or alias is `value`, ignoring case. */
export function licenseFor(value: string): LicenseRow | undefined {
  const key = value.toLowerCase();
  return LICENSES.find(
    (row) => row.id.toLowerCase() === key || row.aliases.some((alias) => alias.toLowerCase() === key),
  );
}
