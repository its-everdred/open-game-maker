import { familyFor, setFor } from '@ogm/asset-cards';
import type { AssetCard } from '@ogm/contracts';

type Setting = NonNullable<AssetCard['settings']>[number];
const RULES: Array<[Setting, RegExp]> = [
  ['medieval-village', /medieval.*village|village.*medieval/i],
  ['tavern', /tavern|\binn\b/i],
  ['castle', /castle/i],
  ['crypt', /crypt|ossuary/i],
  ['cave', /cave|cavern/i],
  ['dungeon', /dungeon/i],
  ['ruins', /ruin/i],
  ['forest', /forest|woodland/i],
  ['desert', /desert/i],
  ['modern-city', /modern.*city|city.*modern/i],
  ['sci-fi', /sci.?fi|cyberpunk/i],
];

export function settingsFromNames(names: string[]): Setting[] {
  return RULES.filter(([, pattern]) => names.some((name) => pattern.test(name.replace(/[_-]+/g, ' ')))).map(
    ([setting]) => setting,
  );
}

/** Filename tags are provisional; an absent preview means no local render was made. */
export function packMetadata(options: {
  id: string;
  title: string;
  styleFamily?: AssetCard['style_family'];
  cameras?: AssetCard['cameras'];
  top: 'packs' | 'inspiration';
  version: string;
  items: Array<{ kind: string; path: string }>;
  sceneSources: string[];
  prefabSources: string[];
}): Pick<AssetCard, 'style_family' | 'cameras' | 'settings' | 'scenes' | 'prefabs'> {
  const family = options.styleFamily ?? familyFor(options.id);
  const root = `${options.top}/${options.id}/${options.version}/extracted`;
  const settings = settingsFromNames([options.id, options.title, ...options.sceneSources, ...options.prefabSources]);
  const spriteNames = options.items.filter((item) => item.kind === 'sprite').map((item) => item.path);
  const spriteText = [options.id, options.title, setFor(options.id)?.traits.perspective ?? '', ...spriteNames]
    .join(' ')
    .replace(/[_-]+/g, ' ');
  const spriteCameras: NonNullable<AssetCard['cameras']> = [];
  if (spriteNames.length > 0) {
    if (/isometric|\biso\b/i.test(spriteText)) spriteCameras.push('isometric');
    if (/top[ -]?down/i.test(spriteText)) spriteCameras.push('top-down');
    if (/\bside\b|platformer/i.test(spriteText)) spriteCameras.push('side');
  }
  const cameras: NonNullable<AssetCard['cameras']> = options.id.startsWith('smallscaleint-')
    ? ['isometric']
    : options.items.some((item) => item.kind === 'model')
      ? ['isometric', 'top-down', 'third-person', 'first-person', 'side']
      : spriteCameras;
  return {
    ...(family ? { style_family: family } : {}),
    cameras: options.cameras ?? cameras,
    settings,
    scenes: options.sceneSources.map((path) => ({
      path: `${root}/${path}`,
      engine: /\.glb$/i.test(path) ? 'glb' : /\.umap$/i.test(path) ? 'unreal' : 'unity',
      settings: settingsFromNames([options.id, options.title, path]),
      preview: null,
    })),
    prefabs: options.prefabSources.map((path) => `${root}/${path}`),
  };
}
