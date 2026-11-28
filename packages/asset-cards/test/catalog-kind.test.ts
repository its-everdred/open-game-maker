import { describe, expect, it } from 'vitest';

import { catalogKind } from '../src/catalog-kind.js';

describe('catalogue kind mapping', () => {
  it.each([
    ['sprite', 'character', 'sprite'],
    ['sprite', 'sheet', 'sheet'],
    ['sprite/tile', '', 'tile'],
    ['model', 'character', 'model'],
    ['anim', '', 'animation'],
    ['inspiration', 'map', 'map'],
    ['vfx', '', 'effect'],
    ['audio/music/loop', '', 'music'],
    ['audio', 'sfx/foley', 'sfx'],
    ['audio', 'voice', 'voice'],
    ['ui', '', 'ui-kit'],
  ])('maps %s / %s to %s', (kind, subkind, expected) => {
    expect(catalogKind(kind, subkind)).toBe(expected);
  });

  it('does not invent a catalogue kind for an unknown card or unclassified audio', () => {
    expect(catalogKind('texture', 'material')).toBeUndefined();
    expect(catalogKind('audio')).toBeUndefined();
  });
});
