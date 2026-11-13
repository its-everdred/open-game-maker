import { describe, expect, it } from 'vitest';

import { fallbackEditorPalette } from '../src/editor-palette.js';
import type { ResolvedCard } from '../src/types.js';

function card(id: string, kind: string, subkind: string, title: string): ResolvedCard {
  return { id, kind, subkind, title, card_type: 'asset' } as ResolvedCard;
}

describe('fallback editor palette', () => {
  it('includes only locked assets, grouped from catalog types with caller-supplied thumbnails', () => {
    const cards = [
      card('tree', 'model', 'nature', 'Oak tree'),
      card('hero', 'sprite', 'character', 'Hero'),
      card('music', 'audio', 'music/loop', 'Forest music'),
      card('crate', 'model', 'prop', 'Crate'),
      card('other', 'model', 'nature', 'Not locked'),
    ];
    const result = fallbackEditorPalette(['tree', 'hero', 'music', 'crate'], cards, (entry) =>
      entry.id === 'tree' ? '/media/tree' : undefined,
    );
    expect(result.mode).toBe('request');
    expect(result.palette.categories.map(({ id }) => id)).toEqual(['characters', 'scenery', 'props', 'audio']);
    expect(result.palette.items).toEqual([
      { prefab: 'hero', label: 'Hero', category: 'characters' },
      { prefab: 'tree', label: 'Oak tree', category: 'scenery', thumbnail: '/media/tree' },
      { prefab: 'crate', label: 'Crate', category: 'props' },
      { prefab: 'music', label: 'Forest music', category: 'audio' },
    ]);
  });

  it('keeps missing cards addressable without leaking lock paths and deduplicates ids', () => {
    const result = fallbackEditorPalette(['t3:game/unknown-item', 't3:game/unknown-item'], [], () => undefined);
    expect(result.mode).toBe('request');
    expect(result.palette.categories.map(({ id }) => id)).toEqual(['props']);
    expect(result.palette.items).toEqual([
      { prefab: 't3:game/unknown-item', label: 'Unknown item', category: 'props' },
    ]);
  });

  it('marks AI-generated locked assets and never asks for thumbnails of unlocked cards', () => {
    const generated = {
      ...card('generated', 'model', 'prop', 'Stone'),
      generation: { method: 'ai', tool: 'example' },
    } as ResolvedCard;
    const seen: string[] = [];
    const result = fallbackEditorPalette(
      ['generated'],
      [generated, card('unlocked', 'model', 'prop', 'Other')],
      (entry) => {
        seen.push(entry.id);
        return undefined;
      },
    );
    expect(seen).toEqual(['generated']);
    expect(result.palette.items[0]?.aiGenerated).toBe(true);
  });

  it('bounds catalog labels to the game manifest limit', () => {
    const result = fallbackEditorPalette(['long'], [card('long', 'model', 'prop', 'x'.repeat(300))], () => undefined);
    expect(result.palette.items[0]?.label).toHaveLength(200);
  });
});
