import { describe, expect, it } from 'vitest';

import { creditsFromLock, mergeCreditsDocuments, renderCredits, type AssetsLock } from '../src/index.js';

function entry(overrides: Partial<AssetsLock['assets'][number]> = {}): AssetsLock['assets'][number] {
  return {
    id: 't1:example-pack/hero@1',
    sha256: 'a'.repeat(64),
    path: 'hero.png',
    source: 'library',
    license: 'CC-BY-4.0',
    rights: { uses: ['in-game'], audience: 'public', redistribution: 'free', attribution: 'Example Artist' },
    credit: {
      pack: 'example-pack',
      title: 'Example Pack',
      licenseSource: 'License.txt',
      attribution: 'Example Artist',
      source: { label: 'Example', url: 'https://example.test/source' },
    },
    added: '2026-11-02',
    ...overrides,
  };
}

describe('asset credits', () => {
  it('deduplicates a pack and renders attribution under its licence', () => {
    const lock = { assets: [entry(), entry({ id: 't1:example-pack/tree@1', path: 'tree.png' })] };

    expect(creditsFromLock(lock).packs).toHaveLength(1);
    expect(renderCredits(lock)).toContain('## CC-BY-4.0\n- Example Pack — Example Artist (licence: License.txt)');
  });

  it('renders the typed AI generation marker in game credits', () => {
    const lock = {
      assets: [
        entry(),
        entry({
          id: 't1:example-pack/generated-tree@1',
          path: 'generated-tree.png',
          meta: { generation: { method: 'ai', tool: 'Krea 2 Turbo + pixel-art LoRA' } },
        }),
      ],
    };
    expect(creditsFromLock(lock).packs[0]).toMatchObject({ aiGenerated: true });
    expect(renderCredits(lock)).toContain('[AI-generated: Krea 2 Turbo + pixel-art LoRA]');
  });

  it('escapes Markdown syntax in an AI tool label', () => {
    const lock = {
      assets: [entry({ meta: { generation: { method: 'ai', tool: '[tool](https://example.invalid)' } } })],
    };
    expect(renderCredits(lock)).toContain('[AI-generated: \\[tool\\](https://example.invalid)]');
  });

  it('neutralizes bidirectional controls in an AI tool label', () => {
    const lock = {
      assets: [entry({ meta: { generation: { method: 'ai', tool: 'before\u200eafter' } } })],
    };
    expect(renderCredits(lock)).toContain('[AI-generated: before?after]');
  });

  it('refuses missing or inconsistent metadata instead of publishing partial credits', () => {
    expect(() => creditsFromLock({ assets: [entry({ credit: undefined })] })).toThrow('missing credit metadata');
    expect(() =>
      creditsFromLock({
        assets: [
          entry(),
          entry({
            id: 't1:example-pack/tree@1',
            credit: { ...entry().credit!, attribution: 'Someone else' },
          }),
        ],
      }),
    ).toThrow('inconsistent credit metadata');
  });

  it('merges matching build documents and rejects inconsistent pack records', () => {
    const pack = creditsFromLock({ assets: [entry()] }).packs[0]!;

    expect(
      mergeCreditsDocuments([
        { version: 1, packs: [pack] },
        { version: 1, packs: [pack] },
      ]).packs,
    ).toEqual([pack]);
    expect(() =>
      mergeCreditsDocuments([
        { version: 1, packs: [pack] },
        { version: 1, packs: [{ ...pack, attribution: 'Someone else' }] },
      ]),
    ).toThrow('inconsistent credit metadata');
  });
});
