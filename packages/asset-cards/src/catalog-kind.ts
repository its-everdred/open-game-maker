/** Kinds presented by the asset catalogue, independent of the card vocabulary. */
export const CATALOG_KINDS = [
  'sprite',
  'sheet',
  'model',
  'animation',
  'map',
  'tile',
  'effect',
  'music',
  'sfx',
  'voice',
  'ui-kit',
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

/** Translate a card kind/count key to the catalogue vocabulary. Unknown kinds stay unclassified. */
export function catalogKind(kind: string, subkind = ''): CatalogKind | undefined {
  const [top, ...rest] = kind.toLowerCase().split('/');
  const detail = (subkind || rest.join('/')).toLowerCase();
  switch (top) {
    case 'sprite':
      if (detail === 'tile' || detail.startsWith('tile/')) return 'tile';
      if (detail === 'sheet' || detail.startsWith('sheet/')) return 'sheet';
      return 'sprite';
    case 'model':
      return 'model';
    case 'anim':
    case 'animation':
      return 'animation';
    case 'inspiration':
      return detail === 'map' || detail.startsWith('map/') ? 'map' : undefined;
    case 'map':
      return 'map';
    case 'tile':
      return 'tile';
    case 'sheet':
      return 'sheet';
    case 'vfx':
    case 'effect':
      return 'effect';
    case 'ui':
    case 'ui-kit':
      return 'ui-kit';
    case 'audio':
      if (detail === 'music' || detail.startsWith('music/')) return 'music';
      if (detail === 'sfx' || detail.startsWith('sfx/')) return 'sfx';
      if (detail === 'voice' || detail.startsWith('voice/')) return 'voice';
      return undefined;
    case 'music':
      return 'music';
    case 'sfx':
      return 'sfx';
    case 'voice':
      return 'voice';
    default:
      return undefined;
  }
}
