import { StableIdSchema, type DesignDoc, type Entity } from '@ogm/contracts/browser';
import { parseScenery, ScenerySchema, type Scenery } from '@ogm/contracts/scenery';

const PREFIX = 'scenery:';
const SETTINGS = 'scenery.settings';
type Asset = { id: string };

/** Add a scenery file to a design document without disturbing the game's own entities. */
export function sceneryToDesign(scene: Scenery, doc: DesignDoc, stableId: (itemId: string) => string): DesignDoc {
  const next = structuredClone(doc);
  scene = ScenerySchema.parse(scene);
  if (
    SETTINGS in next.globals ||
    'scenery.lighting' in next.globals ||
    'scenery.terrain' in next.globals ||
    'scenery.backdrop' in next.globals
  )
    throw new Error('design already has scenery settings');
  next.globals['scenery.lighting'] = scene.lighting;
  next.globals['scenery.terrain'] = scene.terrain;
  if (scene.backdrop) next.globals['scenery.backdrop'] = scene.backdrop;
  next.globals[SETTINGS] = {
    version: scene.version,
    terrain: scene.terrain,
    lighting: scene.lighting,
    camera: scene.camera,
    ...(scene.backdrop ? { backdrop: scene.backdrop } : {}),
  };
  for (const item of scene.items) {
    const id = StableIdSchema.parse(stableId(item.id));
    if (next.entities[id]) throw new Error(`design entity already exists: ${id}`);
    next.entities[id] = {
      id,
      prefab: `${PREFIX}${item.assetId}`,
      level: 'main',
      origin: 'creator',
      props: {
        sceneryItemId: item.id,
        layer: item.layer,
        scale: item.scale,
        rotation: item.rotation,
        ...(item.parallax === undefined ? {} : { 'scenery.parallax': item.parallax }),
        pose: { position: item.position, rotationY: (item.rotation[1] * 180) / Math.PI },
      },
    };
  }
  return next;
}

/** Read the effective document after creator transactions back into the same scenery format. */
export function sceneryFromDesign(doc: DesignDoc, assets: readonly Asset[]): Scenery {
  const settings = doc.globals[SETTINGS];
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('design has no scenery settings');
  const items = Object.values(doc.entities)
    .filter((entity) => entity.prefab.startsWith(PREFIX))
    .map(toItem);
  const backdrop = doc.globals['scenery.backdrop'] ?? (settings as { backdrop?: unknown }).backdrop;
  return parseScenery(
    {
      ...settings,
      lighting: doc.globals['scenery.lighting'] ?? (settings as { lighting?: unknown }).lighting,
      terrain: doc.globals['scenery.terrain'] ?? (settings as { terrain?: unknown }).terrain,
      ...(backdrop === undefined ? {} : { backdrop }),
      items,
    },
    assets,
  );
}

function toItem(entity: Entity): Scenery['items'][number] {
  const props = entity.props;
  const pose = props.pose as { position?: unknown; rotationY?: unknown } | undefined;
  const rotation = Array.isArray(props.rotation) ? [...props.rotation] : [0, 0, 0];
  if (typeof pose?.rotationY === 'number') rotation[1] = (pose.rotationY * Math.PI) / 180;
  const position = Array.isArray(pose?.position) ? [...pose.position] : pose?.position;
  if (Array.isArray(position) && typeof props['scenery.depth'] === 'number') position[2] = props['scenery.depth'];
  const parallax = props['scenery.parallax'] ?? props.parallax;
  return {
    id: typeof props.sceneryItemId === 'string' ? props.sceneryItemId : entity.id,
    assetId: entity.prefab.slice(PREFIX.length),
    position: position as [number, number, number],
    rotation: rotation as [number, number, number],
    scale: (props.scale ?? [1, 1, 1]) as [number, number, number],
    layer: (props.layer ?? 'mid') as Scenery['items'][number]['layer'],
    ...(typeof parallax === 'number' ? { parallax } : {}),
  };
}
